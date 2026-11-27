-- Let people correct their own name, job title, phone and organisation on the Profile screen.
-- Only their own row can change, and never their Company ID, role or approval.

create or replace function update_my_details(p_first text, p_last text, p_job_title text, p_phone text, p_organisation text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  update staff_accounts
  set first_name = nullif(trim(p_first), ''),
      last_name = nullif(trim(p_last), ''),
      job_title = nullif(trim(p_job_title), ''),
      phone = nullif(trim(p_phone), ''),
      organisation = coalesce(trim(p_organisation), '')
  where user_id = auth.uid();
  if not found then
    raise exception 'No account found.';
  end if;
end;
$$;

grant execute on function update_my_details(text, text, text, text, text) to authenticated;
