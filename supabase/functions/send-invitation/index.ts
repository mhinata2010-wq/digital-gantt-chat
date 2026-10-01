import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const escapeHtml=(value:string)=>value.replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]||char));
const sha256=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');

Deno.serve(async request=>{
  const site=Deno.env.get('PUBLIC_SITE_URL');
  let allowed:URL|null=null;try{if(site)allowed=new URL(site)}catch{}
  const origin=request.headers.get('Origin')||'';
  const allowedOrigins=new Set(['http://localhost:4173','http://127.0.0.1:4173',...(allowed?[allowed.origin]:[])]);
  const cors={'Access-Control-Allow-Origin':allowedOrigins.has(origin)?origin:'','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(request.method==='OPTIONS')return allowedOrigins.has(origin)?new Response('ok',{headers:cors}):json({error:'origin not allowed'},403);
  if(origin&&!allowedOrigins.has(origin))return json({error:'origin not allowed'},403);
  if(request.method!=='POST')return json({error:'method not allowed'},405);
  const authorization=request.headers.get('Authorization');if(!authorization)return json({error:'authentication required'},401);
  const url=Deno.env.get('SUPABASE_URL'),publishable=Deno.env.get('SUPABASE_PUBLISHABLE_KEY')||Deno.env.get('SUPABASE_ANON_KEY'),resendKey=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('INVITE_FROM_EMAIL');
  if(!url||!publishable)return json({error:'Supabase function environment is incomplete'},503);
  if(!resendKey||!from||!allowed)return json({configured:false,error:'Invitation email provider is not configured'},503);
  const client=createClient(url,publishable,{global:{headers:{Authorization:authorization}}});
  const {data:{user},error:userError}=await client.auth.getUser();if(userError||!user)return json({error:'invalid session'},401);
  const {invitationId,inviteUrl}=await request.json();
  let candidate:URL|null=null;try{if(typeof inviteUrl==='string')candidate=new URL(inviteUrl)}catch{}
  const token=candidate?new URLSearchParams(candidate.hash.slice(1)).get('invite'):null;
  if(typeof invitationId!=='string'||!candidate||candidate.origin!==allowed.origin||candidate.pathname!==allowed.pathname||candidate.search||candidate.username||candidate.password||!token||!/^[0-9a-f]{64}$/.test(token)||candidate.hash!==`#invite=${token}`)return json({error:'invalid invitation payload'},400);
  const {data:invitation,error}=await client.from('project_invitations').select('id,project_id,email,role,token_hash,expires_at,accepted_at,revoked_at,project:projects(name)').eq('id',invitationId).single();
  if(error||!invitation)return json({error:'invitation not found'},404);
  const {data:owner}=await client.from('project_members').select('id').eq('project_id',invitation.project_id).eq('user_id',user.id).eq('role','owner').maybeSingle();
  if(!owner)return json({error:'owner permission required'},403);
  if(invitation.accepted_at||invitation.revoked_at||new Date(invitation.expires_at)<=new Date())return json({error:'invitation inactive'},410);
  if(await sha256(token)!==invitation.token_hash)return json({error:'invitation token mismatch'},400);
  const projectName=escapeHtml((invitation.project as {name?:string})?.name||'工程表'),safeUrl=escapeHtml(inviteUrl),role=invitation.role==='editor'?'編集者':'閲覧者';
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[invitation.email],subject:`【snake site】${projectName}への招待`,html:`<h1>${projectName}への招待</h1><p>${role}として工程表へ招待されました。</p><p><a href="${safeUrl}">招待を受ける</a></p><p>このリンクは${escapeHtml(invitation.expires_at)}まで有効です。招待先と同じメールアドレスでログインしてください。</p>`})});
  if(!response.ok)return json({error:'email delivery failed',providerStatus:response.status},502);
  return json({configured:true,sent:true});
});
