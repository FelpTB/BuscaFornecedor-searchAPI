-- Migration 009: allowlist do modo de busca com agente
-- Coluna busca_fornecedor.usuario_comprador.acesso_agente
--   • default false — cadastro novo NÃO entra no agente
--   • backfill dos 20 compradores da visualização "usuários com potencial" (19/08/2026)
--   • trigger impede que authenticated/anon se auto-habilitem
--
-- Rollback:
--   DROP TRIGGER IF EXISTS usuario_comprador_protect_acesso_agente
--     ON busca_fornecedor.usuario_comprador;
--   DROP FUNCTION IF EXISTS busca_fornecedor.protect_acesso_agente();
--   ALTER TABLE busca_fornecedor.usuario_comprador DROP COLUMN IF EXISTS acesso_agente;

ALTER TABLE busca_fornecedor.usuario_comprador
  ADD COLUMN IF NOT EXISTS acesso_agente boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN busca_fornecedor.usuario_comprador.acesso_agente IS
  'Allowlist do modo de busca com agente (UI do assistente). Default false; só service_role/postgres altera. População inicial = visualização de usuários com potencial (ago/2026).';

CREATE INDEX IF NOT EXISTS usuario_comprador_acesso_agente_true_idx
  ON busca_fornecedor.usuario_comprador (id)
  WHERE acesso_agente = true;

-- Impede UPDATE da flag via PostgREST autenticado (RLS update_own cobriria a linha inteira).
CREATE OR REPLACE FUNCTION busca_fornecedor.protect_acesso_agente()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.acesso_agente IS DISTINCT FROM OLD.acesso_agente
     AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'acesso_agente só pode ser alterado pelo backend'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS usuario_comprador_protect_acesso_agente
  ON busca_fornecedor.usuario_comprador;

CREATE TRIGGER usuario_comprador_protect_acesso_agente
  BEFORE UPDATE ON busca_fornecedor.usuario_comprador
  FOR EACH ROW
  EXECUTE FUNCTION busca_fornecedor.protect_acesso_agente();

-- 20 perfis da visualização de potencial (ids conferidos em 21/08/2026).
UPDATE busca_fornecedor.usuario_comprador
   SET acesso_agente = true
 WHERE id IN (
   'bc073824-9310-41b9-963a-7f25544e8668', -- Rh NutriWord / GRAO NUTRIWORLD
   'cae0a454-866b-42c2-a1db-32564aad8099', -- Thiago de Oliveira Freitas / Bracell Bahia
   'e8f037af-bf30-4e5f-8cde-cc581e700a67', -- Míriam Sara de Resende Pardinho / Komatsu
   'e21b4ba5-05ce-4ece-9a4b-c7c8a4391701', -- Anderson Ricardo / Vetorial
   '8a14efba-a4ae-45ac-a3ae-9c43157f7f68', -- Celeste Paulino de Azevedo / RP distribuidora
   '67e9f2c2-3c2f-4352-beba-633ca78a1c8f', -- Igor Oliveira / MRV
   '007857fa-800a-4222-8a08-45e616e59fc7', -- Matheus / AJI Engenharia (WhatsApp)
   '3929b5d4-06ca-4d78-954c-10039005f1bb', -- Ariesa / XMobots
   'c7406f59-da6d-4f03-bb5d-f5b43ecb6a5b', -- Guilherme Bergamo / Bracell Celulose
   'ea475704-bd7b-4043-9a77-44d0e9a5f979', -- Erika Cristina de Oliveira Potomatti / Método
   '7fd4cf66-f617-45a3-8d20-5761c26ce7c7', -- Rafael Brito
   '985e6bb7-112f-4399-8f87-cb6a7a933536', -- Luis Alexandre Salata Macedo / Bracell
   '1641682d-72bc-4d5b-b7fc-94d4817a9182', -- Patricia Duarte da Silva / C&A
   'fedcc848-eec4-4989-b585-1906a7bcc9fd', -- João Pedro Grigoletto / Astra
   'e575f46d-258d-4e67-8454-1bff2a75c9ac', -- Tayroni Xavier / Komatsu
   '551f9386-6b75-42c1-9227-b17001934b3e', -- otaviano freitas / Bracell
   '8e3fb4df-214d-4a7c-a95e-cf48dec8a28a', -- Ingrid Barrios (PF, 10 buscas)
   'a5d51ff6-86cf-4ebd-84ec-caaa9d0efb7d', -- P.E. / Pura Elegância
   '225e3040-de73-4695-bf47-f97e1507051c', -- ANGELICA A FERREIRA / A Yoshii
   'd2765df2-707b-4536-9628-1dca59e9e39f'  -- Juliana Gardênia … Bragança / Constrowins
 );
