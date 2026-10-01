const DB_NAME='snake-field-cache',DB_VERSION=1;

function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('projects'))db.createObjectStore('projects',{keyPath:'key'});if(!db.objectStoreNames.contains('operations')){const store=db.createObjectStore('operations',{keyPath:'id'});store.createIndex('user','userId')}};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function store(name,mode='readonly'){const db=await database();return db.transaction(name,mode).objectStore(name)}
function requestResult(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}

export async function cacheProject(userId,payload){const object=await store('projects','readwrite');await requestResult(object.put({key:`${userId}:${payload.project.id}`,userId,cachedAt:new Date().toISOString(),payload}))}
export async function readCachedProject(userId,projectId){const object=await store('projects');return requestResult(object.get(`${userId}:${projectId}`))}
export async function queueProgress(userId,projectId,task,values){const object=await store('operations','readwrite'),operation={id:crypto.randomUUID(),userId,projectId,taskId:task.id,baseVersion:task.version,taskName:task.name,values,createdAt:new Date().toISOString()};await requestResult(object.put(operation));return operation}
export async function pendingOperations(userId){const object=await store('operations');return requestResult(object.index('user').getAll(userId))}
export async function removeOperation(id){const object=await store('operations','readwrite');await requestResult(object.delete(id))}
export async function clearOfflineUser(userId){const db=await database(),tx=db.transaction(['projects','operations'],'readwrite');for(const name of ['projects','operations']){const object=tx.objectStore(name),request=object.openCursor();await new Promise((resolve,reject)=>{request.onsuccess=()=>{const cursor=request.result;if(!cursor)return resolve();if(cursor.value.userId===userId)cursor.delete();cursor.continue()};request.onerror=()=>reject(request.error)})}}
