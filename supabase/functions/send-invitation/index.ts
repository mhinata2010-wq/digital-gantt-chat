import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const escapeHtml=(value:string)=>value.replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]||char));

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(request.method!=='POST')return json({error:'method not allowed'},405);
  const authorization=request.headers.get('Authorization');if(!authorization)return json({error:'authentication required'},401);
  const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),resendKey=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('INVITE_FROM_EMAIL'),site=Deno.env.get('PUBLIC_SITE_URL');
  if(!url||!anon)return json({error:'Supabase function environment is incomplete'},503);
  if(!resendKey||!from||!site)return json({configured:false,error:'Invitation email provider is not configured'},503);
  const client=createClient(url,anon,{global:{headers:{Authorization:authorization}}});
  const {invitationId,inviteUrl}=await request.json();
  if(typeof invitationId!=='string'||typeof inviteUrl!=='string'||!inviteUrl.startsWith(site))return json({error:'invalid invitation payload'},400);
  const {data:invitation,error}=await client.from('project_invitations').select('id,email,role,expires_at,project:projects(name)').eq('id',invitationId).single();
  if(error||!invitation)return json({error:'invitation not found'},404);
  if(new Date(invitation.expires_at)<=new Date())return json({error:'invitation expired'},410);
  const projectName=escapeHtml((invitation.project as {name?:string})?.name||'工程表'),safeUrl=escapeHtml(inviteUrl),role=invitation.role==='editor'?'編集者':'閲覧者';
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[invitation.email],subject:`【snake site】${projectName}への招待`,html:`<h1>${projectName}への招待</h1><p>${role}として工程表へ招待されました。</p><p><a href="${safeUrl}">招待を受ける</a></p><p>このリンクは${escapeHtml(invitation.expires_at)}まで有効です。招待先と同じメールアドレスでログインしてください。</p>`})});
  if(!response.ok)return json({error:'email delivery failed',providerStatus:response.status},502);
  return json({configured:true,sent:true});
});
