# SAW054 — create/update Lambda + EventBridge Scheduler for Ross Amplify cron.
# Requires: AWS CLI, Compress-Archive, env CRON_SECRET (and optional BASE_URL).
# Usage:  $env:CRON_SECRET='...'; pwsh ./upsert-ross-cron.ps1

$ErrorActionPreference = "Stop"
$region = if ($env:AWS_REGION) { $env:AWS_REGION } else { "ap-southeast-2" }
$account = (aws sts get-caller-identity --query Account --output text).Trim()
$base = if ($env:BASE_URL) { $env:BASE_URL.TrimEnd("/") } else { "https://main.d17ivsmdf92nf8.amplifyapp.com" }
$cron = $env:CRON_SECRET
if (-not $cron) { throw "Set CRON_SECRET env var" }

$here = $PSScriptRoot
$fnName = "ross-cron-invoke"
$fnArn = "arn:aws:lambda:${region}:${account}:function:${fnName}"
$lambdaRole = "arn:aws:iam::${account}:role/RossCronLambdaRole"
$schedRole = "arn:aws:iam::${account}:role/RossSchedulerInvokeRole"

Write-Host "Account=$account region=$region base=$base"

aws iam put-role-policy `
  --role-name RossSchedulerInvokeRole `
  --policy-name RossInvokeCronLambda `
  --policy-document "file://$here/ross-scheduler-invoke-policy.json" | Out-Null

$zipPath = Join-Path $env:TEMP "ross-cron-lambda.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $here "lambda\index.py") -DestinationPath $zipPath -Force

aws lambda get-function --function-name $fnName --region $region 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  aws lambda update-function-code --function-name $fnName --zip-file "fileb://$zipPath" --region $region | Out-Null
  aws lambda wait function-updated --function-name $fnName --region $region
  aws lambda update-function-configuration `
    --function-name $fnName --region $region --timeout 120 --memory-size 256 `
    --environment "Variables={BASE_URL=$base,CRON_SECRET=$cron}" | Out-Null
  aws lambda wait function-updated --function-name $fnName --region $region
} else {
  aws lambda create-function `
    --function-name $fnName --runtime python3.12 --role $lambdaRole `
    --handler index.handler --zip-file "fileb://$zipPath" `
    --timeout 120 --memory-size 256 --region $region `
    --environment "Variables={BASE_URL=$base,CRON_SECRET=$cron}" `
    --description "SAW054 POST Amplify Ross cron routes" | Out-Null
  aws lambda wait function-active --function-name $fnName --region $region
}

$flexPath = Join-Path $here "flexible-time-off.json"
[System.IO.File]::WriteAllText($flexPath, '{"Mode":"OFF"}')

function Upsert-Schedule([string]$name, [string]$expression, [string]$timezone, [string]$path) {
  $targetPath = Join-Path $env:TEMP "target-$name.json"
  $target = @{
    Arn = $fnArn
    RoleArn = $schedRole
    Input = (@{ path = $path } | ConvertTo-Json -Compress)
    RetryPolicy = @{ MaximumEventAgeInSeconds = 3600; MaximumRetryAttempts = 2 }
  } | ConvertTo-Json -Depth 6 -Compress
  [System.IO.File]::WriteAllText($targetPath, $target)

  $cmd = @(
    "scheduler", "create-schedule",
    "--name", $name, "--region", $region,
    "--schedule-expression", $expression,
    "--flexible-time-window", "file://$flexPath",
    "--target", "file://$targetPath",
    "--state", "ENABLED",
    "--description", "SAW054 Ross Amplify cron"
  )
  if ($timezone) { $cmd += @("--schedule-expression-timezone", $timezone) }

  aws scheduler get-schedule --name $name --region $region 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $cmd[1] = "update-schedule" }
  & aws @cmd | Out-Null
  Write-Host "schedule $name OK"
}

Upsert-Schedule "ross-emergency-scan" "rate(30 minutes)" $null "/api/v1/worker/run"
Upsert-Schedule "ross-leave-cycle" "rate(1 hour)" $null "/api/v1/leave/run"
Upsert-Schedule "ross-planner-daily" "cron(0 2 * * ? *)" "Australia/Adelaide" "/api/v1/planner/run"

aws scheduler list-schedules --region $region --output table
Write-Host "Done."
