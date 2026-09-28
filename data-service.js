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
export async function loadProjects(){
  const {data,error}=await client.from('project_overview').select('*').order('updated_at',{ascending:false});fail(error);return data||[];
}
export async function createProject(name,startDate){
  const {data,error}=await client.rpc('create_project',{p_name:name,p_start_date:startDate});fail(error);return data;
}
export async function loadProject(id){
  const [{data:project,error:projectError},{data:tasks,error:taskError}]=await Promise.all([
    client.from('project_overview').select('*').eq('id',id).single(),
    client.from('tasks').select('*').eq('project_id',id).order('position')
  ]);
  fail(projectError);fail(taskError);return {project,tasks:tasks||[]};
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
  const {data,error}=await client.from('tasks').delete().eq('id',task.id).eq('version',task.version).select('id').maybeSingle();fail(error);
  if(!data)throw Object.assign(new Error('工程が更新済みのため削除できません。最新データを読み込んでください。'),{code:'CONFLICT'});
}
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
export function subscribe(projectId,onChange,onStatus){
  const channel=client.channel(`project:${projectId}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'projects',filter:`id=eq.${projectId}`},onChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'tasks',filter:`project_id=eq.${projectId}`},onChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'project_members',filter:`project_id=eq.${projectId}`},onChange)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'project_history',filter:`project_id=eq.${projectId}`},onChange)
    .subscribe(onStatus);
  return ()=>client.removeChannel(channel);
}
