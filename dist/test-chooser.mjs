/** Opening or cancelling the chooser never changes the current session. */
export function createTestChooser({ state, dialog, trigger, choices, apply, confirmChange }) {
  function select(next) {
    if (state.running) return false;
    if (next === state.testType) return true;
    const hasWork = state.reviewFrames.length || state.human?.marks?.size || state.human?.reviewed?.size;
    if (hasWork && !confirmChange(`Switch to ${next === 'light-dark' ? 'Light / dark' : 'Shoaling'}? This clears the current analysis, frame corrections, and review marks. Export any results you want to keep first.`)) return false;
    apply(next);
    return true;
  }
  trigger.addEventListener('click', () => {
    if (state.running || dialog.open) return;
    for (const [test, button] of Object.entries(choices)) {
      button.textContent = `${test === state.testType ? 'Keep' : 'Switch to'} ${test === 'light-dark' ? 'Light / dark' : 'Shoaling'}`;
    }
    dialog.showModal();
  });
  for (const [test, button] of Object.entries(choices)) {
    button.addEventListener('click', () => { if (select(test)) dialog.close(); });
  }
  return { select };
}
