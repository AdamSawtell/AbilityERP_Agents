module.exports = {
  apps: [
    {
      name: 'ross-roster',
      script: 'dist/index.js',
      cwd: '/opt/ross-roster',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
      max_memory_restart: '512M',
      time: true,
    },
  ],
};
