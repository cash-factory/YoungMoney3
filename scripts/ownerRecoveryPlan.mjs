export function sql(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}
export function buildOwnerRecoverySql({email,userId,hash,salt,auditId,stamp}) {
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[0-9a-f-]{36}$/i.test(userId)) throw Error('Invalid administrator identity.');
  if(!hash || !salt || !auditId || !stamp) throw Error('Missing recovery metadata.');
  const owner="id="+sql(userId)+" AND email="+sql(email)+" AND role='admin'";
  const selector='(SELECT id FROM users WHERE '+owner+')';
  return [
    "UPDATE users SET password_hash="+sql(hash)+",password_salt="+sql(salt)+",account_status='active',suspended_at=NULL,suspension_expires_at=NULL,updated_at="+sql(stamp)+" WHERE "+owner+";",
    "DELETE FROM sessions WHERE user_id="+selector+";",
    "DELETE FROM recovery_codes WHERE user_id="+selector+";",
    "INSERT INTO admin_audit_log(id,actor_user_id,target_user_id,action,outcome,metadata,created_at) SELECT "+sql(auditId)+",id,id,'operator-admin-recovery','success','{\"provider_authorized\":true}',"+sql(stamp)+" FROM users WHERE "+owner+";",
  ].join('\n')+'\n';
}
