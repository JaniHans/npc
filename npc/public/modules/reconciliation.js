export function dropAckedInputs(pendingInputs = [], lastProcessedInputSeq = 0) {
  if (!Array.isArray(pendingInputs)) {
    return [];
  }

  return pendingInputs.filter(
    (input) =>
      input &&
      typeof input.inputSeq === "number" &&
      input.inputSeq > lastProcessedInputSeq,
  );
}

export function replayPendingInputs(
  baseState = {},
  pendingInputs = [],
  applyInput,
) {
  if (typeof applyInput !== "function") {
    throw new TypeError("applyInput must be a function");
  }

  let replayState = { ...baseState };
  for (const input of pendingInputs) {
    const nextState = applyInput(replayState, input);
    if (nextState && typeof nextState === "object") {
      replayState = nextState;
    }
  }
  return replayState;
}

export function reconcileLocalPlayer(
  authoritativeState = {},
  pendingInputs = [],
  lastProcessedInputSeq = 0,
  applyInput,
) {
  const remainingInputs = dropAckedInputs(
    pendingInputs,
    lastProcessedInputSeq,
  );
  const state = replayPendingInputs(
    authoritativeState,
    remainingInputs,
    applyInput,
  );

  return { state, pendingInputs: remainingInputs };
}

// Manual learning helper; call from console if you want to validate logic quickly.
export function runReconciliationDebugCase() {
  const authoritativeState = { x: 100, y: 50 };
  const sourcePendingInputs = [
    { inputSeq: 41, dx: 1, dy: 0 },
    { inputSeq: 42, dx: 1, dy: 0 },
    { inputSeq: 43, dx: 2, dy: -1 },
  ];
  const lastProcessedInputSeq = 42;

  function applyInput(state, input) {
    return {
      ...state,
      x: state.x + input.dx,
      y: state.y + input.dy,
    };
  }

  const result = reconcileLocalPlayer(
    authoritativeState,
    sourcePendingInputs,
    lastProcessedInputSeq,
    applyInput,
  );

  console.assert(
    result.pendingInputs.length === 1 &&
      result.pendingInputs[0].inputSeq === 43,
    "Expected only inputSeq 43 to remain pending",
  );
  console.assert(
    result.state.x === 102 && result.state.y === 49,
    "Expected reconciled state to be x=102, y=49",
  );
  console.assert(
    sourcePendingInputs.length === 3,
    "Expected source pending array to remain unchanged",
  );

  return result;
}
