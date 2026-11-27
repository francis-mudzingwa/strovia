-- An administrator account can never be deleted from the app, not even by another administrator.
create or replace function admin_delete_account(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Administrators only.';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot delete your own account.';
  end if;
  if exists (select 1 from staff_accounts where user_id = p_user and role = 'admin') then
    raise exception 'Administrator accounts cannot be deleted here.';
  end if;
  perform log_activity(null, 'deleted an account', (select coalesce(email::text, id::text) from auth.users where id = p_user));
  delete from auth.users where id = p_user;
end;
$$;
