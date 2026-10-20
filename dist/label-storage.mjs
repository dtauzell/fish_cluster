/** IndexedDB stores clean images alongside annotations, one frame per write. */
export function createLabelStorage() {
  const opened = new Promise((resolve, reject) => {
    const request = indexedDB.open('fish-cluster-labeling', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('projects', { keyPath: 'id' });
      const frames = request.result.createObjectStore('frames', { keyPath: 'key' });
      frames.createIndex('projectId', 'projectId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function transaction(stores, mode, operation) {
    const database = await opened;
    return new Promise((resolve, reject) => {
      const tx = database.transaction(stores, mode);
      const result = operation(tx);
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Could not save labels.'));
    });
  }
  return {
    async load(project) {
      const records = await transaction(['frames'], 'readonly', tx =>
        tx.objectStore('frames').index('projectId').getAll(project.id));
      return records.map(({ key, projectId, ...record }) => record);
    },
    async saveProject(project) {
      const { records, ...metadata } = project;
      await transaction(['projects'], 'readwrite', tx => tx.objectStore('projects').put(metadata));
    },
    async saveFrame(projectId, record) {
      await transaction(['frames'], 'readwrite', tx => tx.objectStore('frames').put({
        ...record, projectId, key: `${projectId}:${record.frameIndex}` }));
    },
    async replace(project) {
      const database = await opened;
      await new Promise((resolve, reject) => {
        const tx = database.transaction(['projects', 'frames'], 'readwrite');
        const store = tx.objectStore('frames');
        const request = store.index('projectId').openCursor(project.id);
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
          else for (const record of project.records) store.put({ ...record, projectId: project.id, key: `${project.id}:${record.frameIndex}` });
        };
        const { records, ...metadata } = project;
        tx.objectStore('projects').put(metadata);
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    }
  };
}
