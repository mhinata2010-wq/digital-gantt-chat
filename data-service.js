const config=window.SNAKE_CONFIG||{};
export const configured=Boolean(
  window.supabase&&
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl||'')&&
  config.supabasePublishableKey&&
  !config.supabasePublishableKey.includes('YOUR_')
);

export const client=configured?window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
}):null;

function fail(error){if(error)throw error}

export async function session(){
  const {data,error}=await client.auth.getSession();fail(error);return data.session;
}
export async function signUp(email,password,displayName){
  const {data,error}=await client.auth.signUp({email,password,options:{data:{display_name:displayName},emailRedirectTo:new URL('./',location.href).href}});fail(error);return data;
}
export async function signIn(email,password){
  const {data,error}=await client.auth.signInWithPassword({email,password});fail(error);return data;
}
export async function signOut(){const {error}=await client.auth.signOut();fail(error)}
export async function sendPasswordReset(email){
  const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:new URL('./',location.href).href});fail(error);
}
export async function claimInvitations(){const {error}=await client.rpc('claim_project_invitations');fail(error)}

export async function loadProfile(){
  const {data,error}=await client.from('profiles').select('id,email,display_name').single();fail(error);return data;
}
export async function updateProfileName(displayName){
  const {data,error}=await client.from('profiles').update({display_name:displayName.trim()}).eq('id',(await session()).user.id).select('id,email,display_name').single();fail(error);return data;
}
export async function loadProjects(){
  const {data,error}=await client.from('project_overview').select('*').order('updated_at',{ascending:false});fail(error);return data||[];
}
export async function createProject(name,startDate){
  const {data,error}=await client.rpc('create_project',{p_name:name,p_start_date:startDate});fail(error);return data;
}
export async function loadProject(id){
  const {data:project,error:projectError}=await client.from('project_overview').select('*').eq('id',id).single();fail(projectError);
  const fieldOperations=Boolean(project&&Object.hasOwn(project,'site_name'));
  let taskQuery=client.from('tasks').select('*').eq('project_id',id);if(fieldOperations)taskQuery=taskQuery.is('archived_at',null);
  const {data:tasks,error:taskError}=await taskQuery.order('position');fail(taskError);
  if(!fieldOperations)return {project,tasks:tasks||[],fieldOperations:false,managementItems:[],versions:[],changeRequests:[],networkLayouts:[],networkEventLayouts:[]};
  const [{data:managementItems,error:itemError},{data:versions,error:versionError},{data:changeRequests,error:changeRequestError},{data:networkLayouts,error:layoutError},{data:networkEventLayouts,error:eventLayoutError}]=await Promise.all([
    client.from('management_items').select('*').eq('project_id',id).order('due_date',{ascending:true,nullsFirst:false}),
    client.from('schedule_versions').select('*').eq('project_id',id).order('version_number',{ascending:false}),
    client.from('schedule_change_requests').select('*').eq('project_id',id).order('created_at',{ascending:false}),
    client.from('network_task_layouts').select('*').eq('project_id',id),
    client.from('network_event_layouts').select('*').eq('project_id',id)
  ]);
  fail(itemError);fail(versionError);fail(changeRequestError);if(layoutError&&!['42P01','PGRST205'].includes(layoutError.code))fail(layoutError);if(eventLayoutError&&!['42P01','PGRST205'].includes(eventLayoutError.code))fail(eventLayoutError);return {project,tasks:tasks||[],fieldOperations:true,managementItems:managementItems||[],versions:versions||[],changeRequests:changeRequests||[],networkLayouts:networkLayouts||[],networkEventLayouts:networkEventLayouts||[]};
}
export async function updateProject(project,patch){
  const {data,error}=await client.from('projects').update({...patch,revision:project.revision+1}).eq('id',project.id).eq('revision',project.revision).select().maybeSingle();fail(error);
  if(!data)throw Object.assign(new Error('別の人が先に案件設定を変更しました。最新データを読み込んでください。'),{code:'CONFLICT'});
  return data;
}
export async function createTask(projectId,values){
  const {data,error}=await client.from('tasks').insert({...values,project_id:projectId}).select().single();fail(error);return data;
}
export async function updateTask(task,values){
  const {data,error}=await client.from('tasks').update({...values,version:task.version+1}).eq('id',task.id).eq('version',task.version).select().maybeSingle();fail(error);
  if(!data)throw Object.assign(new Error('別の人が先にこの工程を変更しました。最新データを読み込んでください。'),{code:'CONFLICT'});
  return data;
}
export async function deleteTask(task){
  if(Object.hasOwn(task,'archived_at')){
    const {data,error}=await client.from('tasks').update({archived_at:new Date().toISOString(),version:task.version+1}).eq('id',task.id).eq('version',task.version).select('id').maybeSingle();fail(error);
    if(!data)throw Object.assign(new Error('工程が更新済みのため削除できません。最新データを読み込んでください。'),{code:'CONFLICT'});return;
  }
  const {data,error}=await client.from('tasks').delete().eq('id',task.id).eq('version',task.version).select('id').maybeSingle();fail(error);
  if(!data)throw Object.assign(new Error('工程が更新済みのため削除できません。最新データを読み込んでください。'),{code:'CONFLICT'});
}
export async function applyScheduleImport(projectId,sourceName,sourceKind,rows){const {data,error}=await client.rpc('apply_schedule_import',{p_project_id:projectId,p_source_name:sourceName,p_source_kind:sourceKind,p_rows:rows});fail(error);return data}
export async function saveNetworkLayout(projectId,taskId,x,y){const {data,error}=await client.from('network_task_layouts').upsert({project_id:projectId,task_id:taskId,x:Math.round(x),y:Math.round(y),pinned:true,updated_at:new Date().toISOString()},{onConflict:'task_id'}).select().single();fail(error);return data}
export async function resetNetworkLayout(projectId){const {data,error}=await client.rpc('reset_network_layout',{p_project_id:projectId});fail(error);return data}
export async function saveNetworkEventLayout(projectId,eventKey,x,y){const {data,error}=await client.from('network_event_layouts').upsert({project_id:projectId,event_key:eventKey,x:Math.round(x),y:Math.round(y),updated_at:new Date().toISOString()},{onConflict:'project_id,event_key'}).select().single();fail(error);return data}
export async function resetNetworkEventLayout(projectId){const {error}=await client.from('network_event_layouts').delete().eq('project_id',projectId);fail(error)}
export async function loadMembers(projectId){
  const {data,error}=await client.from('project_members').select('id,email,role,user_id,accepted_at,created_at').eq('project_id',projectId).order('created_at');fail(error);return data||[];
}
export async function inviteMember(projectId,email,role){
  const {data,error}=await client.rpc('invite_project_member',{p_project_id:projectId,p_email:email,p_role:role});fail(error);return data;
}
export async function changeMemberRole(id,role){
  const {data,error}=await client.from('project_members').update({role}).eq('id',id).select().single();fail(error);return data;
}
export async function removeMember(id){const {error}=await client.from('project_members').delete().eq('id',id);fail(error)}
export async function loadHistory(projectId){
  const {data,error}=await client.from('project_history').select('*').eq('project_id',projectId).order('created_at',{ascending:false}).limit(100);fail(error);return data||[];
}

export async function reportTaskProgress(task,values){
  const {data,error}=await client.rpc('report_task_progress',{
    p_task_id:task.id,p_expected_version:task.version,p_progress:values.progress_percent,
    p_actual_start:values.actual_start||null,p_actual_finish:values.actual_finish||null,
    p_remaining_days:values.remaining_days,p_comment:values.comment||'',p_delay_reason:values.delay_reason||'',
    p_delay_category:values.delay_category||'未分類',p_next_action:values.next_action||'',
    p_inspection_status:values.inspection_status||'未確認',p_notify_next:Boolean(values.notify_next)
  });fail(error);return data;
}
export async function syncPlannedDates(projectId,dates){
  const {data,error}=await client.rpc('sync_task_planned_dates',{p_project_id:projectId,p_dates:dates});fail(error);return data;
}
export async function loadTaskActivity(taskId){
  const [{data:reports,error:reportError},{data:comments,error:commentError},{data:attachments,error:attachmentError}]=await Promise.all([
    client.from('task_reports').select('*').eq('task_id',taskId).order('created_at',{ascending:false}).limit(50),
    client.from('task_comments').select('*').eq('task_id',taskId).is('deleted_at',null).order('created_at',{ascending:true}).limit(100),
    client.from('task_attachments').select('*').eq('task_id',taskId).is('deleted_at',null).order('created_at',{ascending:false}).limit(100)
  ]);fail(reportError);fail(commentError);fail(attachmentError);return {reports:reports||[],comments:comments||[],attachments:attachments||[]};
}
export async function createComment(projectId,taskId,body,mentionedUserIds=[]){
  const {data,error}=await client.from('task_comments').insert({project_id:projectId,task_id:taskId,body,mentioned_user_ids:mentionedUserIds}).select().single();fail(error);return data;
}
export async function uploadTaskFiles(projectId,taskId,files){
  const uploaded=[];
  try{
    for(const file of files){
      if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type))throw new Error(`${file.name} は対応していないファイル形式です。`);
      if(file.size>10485760)throw new Error(`${file.name} は10MB以下にしてください。`);
      const form=new FormData();form.set('projectId',projectId);form.set('taskId',taskId);form.set('file',file,file.name);
      const {data,error}=await client.functions.invoke('upload-project-file',{body:form});fail(error);uploaded.push(data);
    }
    return uploaded;
  }catch(error){if(uploaded.length)await removeUploadedFiles(uploaded.map(item=>item.storage_path)).catch(()=>{});throw error}
}
export async function saveAttachmentRecords(projectId,taskId,items,reportId=null,commentId=null){
  if(!items.length)return [];
  const {data,error}=await client.from('task_attachments').insert(items.map(item=>({...item,project_id:projectId,task_id:taskId,report_id:reportId,comment_id:commentId}))).select();fail(error);return data||[];
}
export async function removeUploadedFiles(paths){if(paths.length){const {error}=await client.functions.invoke('upload-project-file',{body:{action:'delete',paths}});fail(error)}}
export async function signedAttachmentUrl(path){const {data,error}=await client.storage.from('project-files').createSignedUrl(path,900);fail(error);return data.signedUrl}

export async function createManagementItem(values){const {data,error}=await client.from('management_items').insert(values).select().single();fail(error);return data}
export async function updateManagementItem(id,values){const {data,error}=await client.from('management_items').update({...values,updated_by:(await session()).user.id,updated_at:new Date().toISOString()}).eq('id',id).select().single();fail(error);return data}
export async function deleteManagementItem(id){const {error}=await client.from('management_items').delete().eq('id',id);fail(error)}
export async function saveManagementAttachmentRecords(projectId,itemId,items){if(!items.length)return [];const {data,error}=await client.from('management_item_attachments').insert(items.map(item=>({...item,project_id:projectId,management_item_id:itemId}))).select();fail(error);return data||[]}

export async function createScheduleVersion(projectId,name,reason,comment,isBaseline=false){const {data,error}=await client.rpc('create_schedule_version',{p_project_id:projectId,p_name:name,p_reason:reason,p_comment:comment,p_is_baseline:isBaseline});fail(error);return data}
export async function loadVersionTasks(versionId){const {data,error}=await client.from('schedule_version_tasks').select('*').eq('version_id',versionId).order('position');fail(error);return data||[]}
export async function restoreScheduleVersion(versionId){const {error}=await client.rpc('restore_schedule_version',{p_version_id:versionId});fail(error)}

export async function loadScheduleChangeRequests(projectId){
  const {data,error}=await client.from('schedule_change_requests').select('*').eq('project_id',projectId).order('created_at',{ascending:false});fail(error);return data||[];
}
export async function submitScheduleChangeRequest(projectId,taskId,expectedVersion,changeType,proposedPatch,reason,impactData){
  const {data,error}=await client.rpc('submit_schedule_change_request',{
    p_project_id:projectId,p_task_id:taskId,p_expected_version:expectedVersion,
    p_change_type:changeType,p_proposed_patch:proposedPatch,
    p_impact_data:impactData||{},p_reason:reason||''
  });fail(error);return data;
}
export async function reviewScheduleChangeRequest(requestId,decision,reviewComment=''){
  const {data,error}=await client.rpc('review_schedule_change_request',{
    p_request_id:requestId,p_decision:decision,p_review_comment:reviewComment||''
  });fail(error);return data;
}

export async function createInvitation(projectId,email,role,days=7){const {data,error}=await client.rpc('create_project_invitation',{p_project_id:projectId,p_email:email,p_role:role,p_valid_days:days});fail(error);return data?.[0]}
export async function listInvitations(projectId){const {data,error}=await client.from('project_invitations').select('id,email,role,expires_at,accepted_at,revoked_at,created_at').eq('project_id',projectId).order('created_at',{ascending:false});fail(error);return data||[]}
export async function revokeInvitation(id){const {data,error}=await client.from('project_invitations').update({revoked_at:new Date().toISOString()}).eq('id',id).select().single();fail(error);return data}
export async function acceptInvitation(token){const {data,error}=await client.rpc('accept_project_invitation',{p_token:token});fail(error);return data}

export async function loadNotifications(){const {data,error}=await client.from('notifications').select('*').order('created_at',{ascending:false}).limit(100);fail(error);return data||[]}
export async function markNotificationRead(id){const {error}=await client.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id);fail(error)}
export async function markAllNotificationsRead(){const {error}=await client.from('notifications').update({read_at:new Date().toISOString()}).is('read_at',null);fail(error)}
export async function loadNotificationPreferences(){const current=await session();const {data,error}=await client.from('notification_preferences').select('*').eq('user_id',current.user.id).maybeSingle();fail(error);return data||{user_id:current.user.id,in_app:true,email:false,browser:false,line:false}}
export async function saveNotificationPreferences(values){const current=await session();const {data,error}=await client.from('notification_preferences').upsert({user_id:current.user.id,...values,updated_at:new Date().toISOString()}).select().single();fail(error);return data}
export async function importProject(name,startDate,projectValues,tasks){
  const projectId=await createProject(name,startDate);
  if(projectValues&&Object.keys(projectValues).length){
    const loaded=await loadProject(projectId);
    await updateProject(loaded.project,projectValues);
  }
  if(tasks.length){
    const {error}=await client.from('tasks').insert(tasks.map((task,index)=>({...task,project_id:projectId,position:index})));
    fail(error);
  }
  return projectId;
}
export function subscribe(projectId,onChange,onStatus,fieldOperations=false){
  let channel=client.channel(`project:${projectId}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'projects',filter:`id=eq.${projectId}`},onChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'tasks',filter:`project_id=eq.${projectId}`},onChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'project_members',filter:`project_id=eq.${projectId}`},onChange)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'project_history',filter:`project_id=eq.${projectId}`},onChange);
  if(fieldOperations)channel=channel
    .on('postgres_changes',{event:'*',schema:'public',table:'task_reports',filter:`project_id=eq.${projectId}`},onChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'task_comments',filter:`project_id=eq.${projectId}`},onChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'schedule_change_requests',filter:`project_id=eq.${projectId}`},onChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'management_items',filter:`project_id=eq.${projectId}`},onChange);
  channel=channel.subscribe(onStatus);
  return ()=>client.removeChannel(channel);
}
