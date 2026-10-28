// Keep receipt images out of localStorage: photos are stored as Blobs on this device.
const receiptStore = (() => {
  const DB_NAME = 'snake-schedule-receipts-v1';
  const OBJECT = 'photos';
  function open() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(Error('このブラウザでは写真を保存できません'));
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(OBJECT, {keyPath: 'id'});
        store.createIndex('projectTask', ['projectId', 'taskId']);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function transaction(mode, callback) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(OBJECT, mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || Error('写真を保存できませんでした'));
        const request = callback(tx.objectStore(OBJECT));
        if (request) request.onsuccess = () => {result = request.result};
      });
    } finally {db.close()}
  }
  const list = (projectId, taskId) => transaction('readonly', store => store.index('projectTask').getAll([projectId, taskId]));
  const add = (projectId, taskId, file) => transaction('readwrite', store => store.put({
    id: crypto.randomUUID(), projectId, taskId, name: file.name.slice(0, 120),
    createdAt: new Date().toISOString(), blob: file
  }));
  const remove = id => transaction('readwrite', store => store.delete(id));
  async function removeTask(projectId, taskId) {
    const photos = await list(projectId, taskId);
    return transaction('readwrite', store => {photos.forEach(photo => store.delete(photo.id))});
  }
  return {list, add, remove, removeTask};
})();
