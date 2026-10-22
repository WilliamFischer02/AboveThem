/**
 * Which lie checks (src/data/tactics/lieChecks.json ids) the feature cards implement, and where.
 *
 * Deliberately NOT written into lieChecks.json `wiredIn`: that field means "an engine rule already
 * SCORES this" (suspicion). Feature checks are display-only (cards with refs + a question to ask);
 * pointing wiredIn at them would make the catalogue claim scoring that does not exist.
 * lieCheckCoverage.test.ts verifies every id exists in the catalogue and every function exists.
 */
export const FEATURE_LIE_CHECKS: Record<string, string> = {
  // taskCheck.ts — per task / visual-clear claim
  visual_unseen: 'src/engine/features/taskCheck.ts#taskClaimChecks',
  visual_wrong_map: 'src/engine/features/taskCheck.ts#taskClaimChecks',
  visual_off_clear: 'src/engine/features/taskCheck.ts#taskClaimChecks',
  common_not_dealt: 'src/engine/features/taskCheck.ts#taskClaimChecks',
  task_not_on_map: 'src/engine/features/taskCheck.ts#taskClaimChecks',
  task_not_in_room: 'src/engine/features/taskCheck.ts#taskClaimChecks',
  dummy_panel: 'src/engine/features/taskCheck.ts#taskClaimChecks',
  bar_no_move: 'src/engine/features/taskCheck.ts#taskClaimChecks',
  bar_moved_alone: 'src/engine/features/taskCheck.ts#taskClaimChecks',
  // killWindow.ts — constraints
  cooldown_window: 'src/engine/features/killWindow.ts#killWindowFor',
  double_kill_gap: 'src/engine/features/killWindow.ts#doubleKills',
  // security.ts — monitors vs claims
  admin_count_mismatch: 'src/engine/features/security.ts#adminChecks',
  admin_blind_spot: 'src/engine/features/security.ts#adminCovers',
  vitals_timing: 'src/engine/features/security.ts#monitorChecks',
  doorlog_contradiction: 'src/engine/features/security.ts#monitorChecks',
  // voteAnalysis.ts — social
  bandwagon: 'src/engine/features/voteAnalysis.ts#bandwagons',
};
