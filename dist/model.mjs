// Reuse the browser inference worker until the selected model changes.
async function loadInferenceJS() {
  try { return await import('https://cdn.jsdelivr.net/npm/inferencejs@1.2.3/dist/inference.es.js'); }
  catch { throw new Error('Could not load InferenceJS. Check your network connection.'); }
}

export function modelIdentity(config) { return `${config.projectSlug}/${config.version}/${config.key}`; }

export function createModelService() {
  const state = { model: null, modelLoad: null };
  async function prepare(config) {
    const identity = modelIdentity(config);
    if (state.model?.identity === identity) return state.model;
    if (state.modelLoad?.identity === identity) return state.modelLoad.promise;
    const precedingLoad = state.modelLoad?.promise;
    const promise = (async () => {
      if (precedingLoad) { try { await precedingLoad; } catch { /* A newer selection can still load. */ } }
      if (state.model?.identity === identity) return state.model;
      if (state.model) {
        try { await state.model.engine.stopWorker(state.model.workerId); } catch { /* Continue with the new model. */ }
        state.model = null;
      }
      const { InferenceEngine } = await loadInferenceJS();
      const engine = new InferenceEngine();
      const workerId = await engine.startWorker(config.projectSlug, config.version, config.key);
      const model = { identity, engine, workerId };
      state.model = model;
      return model;
    })();
    state.modelLoad = { identity, promise };
    try { return await promise; }
    finally { if (state.modelLoad?.promise === promise) state.modelLoad = null; }
  }

  return { prepare };
}

export function modelErrorMessage(error, config) {
  let payload = error;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { /* Plain text. */ }
  }
  if (typeof payload?.message === 'string' && payload.message.trim().startsWith('{')) {
    try { payload = JSON.parse(payload.message); } catch { /* Plain text. */ }
  }
  const detail = payload?.error?.message ?? payload?.message ?? String(payload);
  const code = payload?.error?.e?.[0]?.code ?? payload?.e?.[0]?.code;
  if (code === 'NO_MODEL' || String(detail).includes('No trained model was found')) {
    return `No trained Roboflow model exists for ${config.projectSlug} version ${config.version}. Choose a trained version in Roboflow’s Models or Deploy tab, or train a model for this project.`;
  }
  if (String(detail).includes('Model initialization failed')) {
    return `Video loaded, but the Roboflow model could not initialize: ${detail}. Check that this model is available for browser inference, then retry.`;
  }
  return `Analysis stopped: ${detail}`;
}
