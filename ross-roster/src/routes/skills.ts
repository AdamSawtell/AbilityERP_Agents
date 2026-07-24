import { Router } from 'express';
import { errorMessage } from '../db/pool';
import { writeAudit } from '../services/audit';
import {
  cycleSkillStatus,
  getSkill,
  getSoftWeights,
  isSkillRunnable,
  listSkills,
  setSkillStatus,
  updateSkillConfig,
  type SkillStatus,
} from '../services/skills';
import { runConfirmCycle } from '../worker/confirm';
import { runEmergencyScan } from '../worker/emergency';
import { runLeaveCycle } from '../worker/leave';
import { runPlannerCycle } from '../worker/planner';
import { runSwapCycle } from '../worker/swap';

export const skillsRouter = Router();

const VALID_STATUS = new Set<SkillStatus>(['on', 'paused', 'off']);

skillsRouter.get('/skills', async (_req, res) => {
  try {
    const skills = await listSkills();
    res.json({ skills });
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});

skillsRouter.get('/skills/:key', async (req, res) => {
  try {
    const skill = await getSkill(String(req.params.key));
    if (!skill) {
      res.status(404).json({ error: 'not_found', message: 'Unknown skill' });
      return;
    }
    const softWeights =
      skill.skill_key === 'worker_matching' ? await getSoftWeights() : undefined;
    res.json({ skill, softWeights });
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});

skillsRouter.patch('/skills/:key', async (req, res) => {
  try {
    const key = String(req.params.key);
    const updatedBy = String(req.body?.updatedBy ?? '').trim() || 'Rostering Officer';
    const before = await getSkill(key);
    if (!before) {
      res.status(404).json({ error: 'not_found', message: 'Unknown skill' });
      return;
    }

    let skill;
    if (req.body?.status !== undefined) {
      const status = String(req.body.status) as SkillStatus;
      if (!VALID_STATUS.has(status)) {
        res.status(400).json({ error: 'invalid_body', message: 'status must be on|paused|off' });
        return;
      }
      skill = await setSkillStatus(key, status, updatedBy);
    } else {
      skill = await cycleSkillStatus(key, updatedBy);
    }

    if (!skill) {
      res.status(404).json({ error: 'not_found', message: 'Unknown skill' });
      return;
    }

    await writeAudit({
      agentType: 'system',
      action: 'skill_toggled',
      approvedBy: updatedBy,
      notes: JSON.stringify({
        skillKey: key,
        before: before.status,
        after: skill.status,
      }),
    });

    res.json({ success: true, skill });
  } catch (err) {
    res.status(503).json({ error: 'skill_update_failed', message: errorMessage(err) });
  }
});

skillsRouter.put('/skills/:key/config', async (req, res) => {
  try {
    const key = String(req.params.key);
    const updatedBy = String(req.body?.updatedBy ?? '').trim() || 'Rostering Officer';
    const skill = await getSkill(key);
    if (!skill) {
      res.status(404).json({ error: 'not_found', message: 'Unknown skill' });
      return;
    }

    if (key === 'worker_matching' && req.body?.soft_weights) {
      const weights = req.body.soft_weights as Record<string, unknown>;
      const soft_weights: Record<string, number> = {};
      for (const [k, v] of Object.entries(weights)) {
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        soft_weights[k] = Math.min(100, Math.max(0, Math.round(n)));
      }
      const nextConfig = { ...skill.config_json, soft_weights };
      const updated = await updateSkillConfig(key, nextConfig, updatedBy);
      await writeAudit({
        agentType: 'system',
        action: 'config_updated',
        approvedBy: updatedBy,
        notes: JSON.stringify({ skillKey: key, soft_weights }),
      });
      res.json({ success: true, skill: updated, softWeights: soft_weights });
      return;
    }

    res.status(400).json({ error: 'invalid_body', message: 'No supported config fields' });
  } catch (err) {
    res.status(503).json({ error: 'skill_config_failed', message: errorMessage(err) });
  }
});

skillsRouter.post('/skills/:key/run', async (req, res) => {
  try {
    const key = String(req.params.key);
    const skill = await getSkill(key);
    if (!skill) {
      res.status(404).json({ error: 'not_found', message: 'Unknown skill' });
      return;
    }

    const runnable = await isSkillRunnable(key);
    if (!runnable) {
      res.status(409).json({
        error: 'skill_off',
        message: `${skill.name} is Off — turn On or Paused to run`,
      });
      return;
    }

    switch (key) {
      case 'shift_scanner':
      case 'worker_matching':
      case 'gap_detector': {
        const summary = await runEmergencyScan('manual');
        res.json({ success: true, skillKey: key, result: summary });
        return;
      }
      case 'pre_shift_confirm': {
        const summary = await runConfirmCycle('manual');
        res.json({ success: true, skillKey: key, result: summary });
        return;
      }
      case 'swap_handler': {
        const summary = await runSwapCycle('manual');
        res.json({ success: true, skillKey: key, result: summary });
        return;
      }
      case 'planner_briefing': {
        const { summary, briefing } = await runPlannerCycle('manual');
        res.json({
          success: true,
          skillKey: key,
          result: { ...summary, fillRate: briefing.fillRate.thisPeriod },
        });
        return;
      }
      case 'leave_replacer': {
        const summary = await runLeaveCycle('manual');
        res.json({ success: true, skillKey: key, result: summary });
        return;
      }
      case 'pathways_message':
      case 'credential_watch':
        res.status(400).json({
          error: 'not_runnable',
          message: `${skill.name} has no standalone runner — use its page or wait for events`,
        });
        return;
      default:
        res.status(400).json({ error: 'not_runnable', message: 'Unknown runner' });
    }
  } catch (err) {
    const message = errorMessage(err);
    if (message.includes('_busy') || message.includes('already_running')) {
      res.status(409).json({ error: 'busy', message });
      return;
    }
    res.status(503).json({ error: 'skill_run_failed', message });
  }
});
