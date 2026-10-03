-- Rode isto uma vez no SQL Editor do Supabase pra devolver o acesso de administrador
-- a patrimonio@patrimonio.com (sem isso, ninguém consegue gerenciar usuários pelo programa).
update public.usuarios set papel = 'admin' where email = 'patrimonio@patrimonio.com';
