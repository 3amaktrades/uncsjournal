-- Save an AI trade analysis and consume its credit in the same transaction.
create or replace function public.save_trade_ai_analysis(
  p_trade_id uuid,
  p_analysis jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_used integer;
  v_trade_id uuid;
begin
  if v_user_id is null then
    raise exception 'Sign in required';
  end if;
  if p_analysis is null or jsonb_typeof(p_analysis) <> 'object' then
    raise exception 'Invalid AI analysis';
  end if;

  select ai_used into v_used
  from public.profiles
  where id = v_user_id
  for update;
  if not found or v_used is null then
    raise exception 'AI credit balance is unavailable';
  end if;
  if v_used >= 5 then
    raise exception 'No AI credits remaining';
  end if;

  update public.trades
  set ai_analysis = p_analysis
  where id = p_trade_id
    and user_id = v_user_id
    and ai_analysis is null
  returning id into v_trade_id;
  if v_trade_id is null then
    raise exception 'Trade not found or already analyzed';
  end if;

  update public.profiles
  set ai_used = v_used + 1
  where id = v_user_id;

  return v_used + 1;
end;
$$;

revoke all on function public.save_trade_ai_analysis(uuid, jsonb) from public;
grant execute on function public.save_trade_ai_analysis(uuid, jsonb) to authenticated;
