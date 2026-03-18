--
-- PostgreSQL database dump
--

-- Dumped from database version 14.15 (Homebrew)
-- Dumped by pg_dump version 14.15 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: actor_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.actor_type AS ENUM (
    'user',
    'merchant',
    'system'
);


--
-- Name: dispute_reason; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.dispute_reason AS ENUM (
    'payment_not_received',
    'crypto_not_received',
    'wrong_amount',
    'fraud',
    'other'
);


--
-- Name: dispute_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.dispute_status AS ENUM (
    'open',
    'investigating',
    'resolved',
    'escalated',
    'pending_confirmation',
    'resolved_user',
    'resolved_merchant',
    'resolved_split'
);


--
-- Name: kyc_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.kyc_status AS ENUM (
    'none',
    'pending',
    'verified',
    'rejected'
);


--
-- Name: merchant_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.merchant_status AS ENUM (
    'pending',
    'active',
    'suspended',
    'banned'
);


--
-- Name: message_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.message_type AS ENUM (
    'text',
    'image',
    'system',
    'dispute',
    'resolution',
    'resolution_proposed',
    'resolution_rejected',
    'resolution_accepted',
    'resolution_finalized'
);


--
-- Name: offer_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.offer_type AS ENUM (
    'buy',
    'sell'
);


--
-- Name: order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_status AS ENUM (
    'pending',
    'accepted',
    'escrow_pending',
    'escrowed',
    'payment_pending',
    'payment_sent',
    'payment_confirmed',
    'releasing',
    'completed',
    'cancelled',
    'disputed',
    'expired'
);


--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_method AS ENUM (
    'bank',
    'cash'
);


--
-- Name: rate_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.rate_type AS ENUM (
    'fixed',
    'market_margin'
);


--
-- Name: accept_order_v1(uuid, character varying, uuid, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_order_v1(p_order_id uuid, p_actor_type character varying, p_actor_id uuid, p_acceptor_wallet_address character varying DEFAULT NULL::character varying) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_order RECORD;
  v_old_status VARCHAR;
  v_updated RECORD;
  v_effective_status order_status;
  v_username VARCHAR;
  v_is_claiming BOOLEAN;
  v_is_m2m BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  v_old_status := v_order.status::TEXT;

  -- Validate transition: accept only from pending or escrowed
  IF v_order.status NOT IN ('pending'::order_status, 'escrowed'::order_status) THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Invalid transition from ' || v_order.status || ' to accepted');
  END IF;

  -- Idempotency: already accepted (status='accepted' OR escrowed with accepted_at set)
  IF v_order.status = 'accepted'::order_status OR v_order.accepted_at IS NOT NULL THEN
    -- Same actor retrying = idempotent success
    IF v_order.buyer_merchant_id = p_actor_id OR v_order.merchant_id = p_actor_id THEN
      RETURN jsonb_build_object('success', true, 'old_status', v_old_status, 'order', row_to_json(v_order));
    END IF;
    -- Different actor = already taken
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_ACCEPTED');
  END IF;

  -- Block self-acceptance of merchant-initiated orders
  IF p_actor_type = 'merchant' AND v_order.merchant_id = p_actor_id THEN
    SELECT username INTO v_username FROM users WHERE id = v_order.user_id;
    IF v_username LIKE 'open_order_%' OR v_username LIKE 'm2m_%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cannot accept your own order');
    END IF;
  END IF;

  v_is_claiming := (p_actor_type = 'merchant'
    AND v_order.status IN ('pending'::order_status, 'escrowed'::order_status)
    AND v_order.merchant_id != p_actor_id);

  v_is_m2m := (p_actor_type = 'merchant'
    AND v_order.status IN ('escrowed'::order_status, 'pending'::order_status)
    AND v_order.merchant_id != p_actor_id);

  -- If accepting an already-escrowed order, keep status as escrowed
  v_effective_status := 'accepted'::order_status;
  IF v_order.status = 'escrowed'::order_status AND v_order.escrow_tx_hash IS NOT NULL THEN
    v_effective_status := 'escrowed'::order_status;
  END IF;

  -- Build UPDATE dynamically based on claiming/m2m logic
  IF (v_is_claiming OR v_is_m2m) AND v_order.escrow_tx_hash IS NOT NULL AND v_order.buyer_merchant_id IS NULL THEN
    -- Escrowed order being claimed: acceptor becomes buyer
    UPDATE orders SET
      status = v_effective_status,
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '120 minutes',
      order_version = order_version + 1,
      buyer_merchant_id = p_actor_id,
      acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
    WHERE id = p_order_id RETURNING * INTO v_updated;
  ELSIF v_is_claiming OR (v_is_m2m AND v_order.buyer_merchant_id IS NOT NULL) THEN
    -- Claiming: acceptor becomes merchant
    UPDATE orders SET
      status = v_effective_status,
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '120 minutes',
      order_version = order_version + 1,
      merchant_id = p_actor_id,
      acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
    WHERE id = p_order_id RETURNING * INTO v_updated;
  ELSIF v_is_m2m AND v_order.buyer_merchant_id IS NULL THEN
    -- M2M: acceptor becomes buyer
    UPDATE orders SET
      status = v_effective_status,
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '120 minutes',
      order_version = order_version + 1,
      buyer_merchant_id = p_actor_id,
      acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
    WHERE id = p_order_id RETURNING * INTO v_updated;
  ELSE
    -- Simple accept (same merchant, no reassignment)
    UPDATE orders SET
      status = v_effective_status,
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '120 minutes',
      order_version = order_version + 1,
      acceptor_wallet_address = COALESCE(p_acceptor_wallet_address, acceptor_wallet_address)
    WHERE id = p_order_id RETURNING * INTO v_updated;
  END IF;

  -- Safety net: block self-referencing result
  IF v_updated.merchant_id = v_updated.buyer_merchant_id THEN
    RAISE EXCEPTION 'Self-referencing order detected after accept (merchant_id = buyer_merchant_id). Rolling back.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'old_status', v_old_status,
    'order', row_to_json(v_updated)
  );
END;
$$;


--
-- Name: auto_expire_orders(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_expire_orders() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Update pending orders that have expired
  UPDATE orders
  SET
    status = 'expired',
    cancelled_at = NOW(),
    cancellation_reason = 'Order expired - merchant did not accept within 15 minutes'
  WHERE
    status = 'pending'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();

  -- Log the expiration count
  RAISE NOTICE 'Auto-expired % pending orders', (
    SELECT COUNT(*)
    FROM orders
    WHERE status = 'expired'
    AND cancelled_at >= NOW() - INTERVAL '1 second'
  );
END;
$$;


--
-- Name: auto_log_order_ledger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_log_order_ledger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_account_type VARCHAR(20);
  v_account_id UUID;
BEGIN
  -- Determine the escrow payer account (prefer recorded fields, fallback to merchant_id)
  v_account_type := COALESCE(NEW.escrow_debited_entity_type, 'merchant');
  v_account_id := COALESCE(NEW.escrow_debited_entity_id, NEW.merchant_id);

  -- Log escrow lock (when escrow_tx_hash is first set)
  IF NEW.escrow_tx_hash IS NOT NULL AND (OLD.escrow_tx_hash IS NULL OR OLD.escrow_tx_hash != NEW.escrow_tx_hash) THEN
    PERFORM log_ledger_entry(
      v_account_type,
      v_account_id,
      'ESCROW_LOCK',
      -NEW.crypto_amount,
      'USDT',
      NEW.id,
      NEW.escrow_tx_hash,
      'Funds locked in escrow for order #' || NEW.order_number,
      jsonb_build_object('order_type', NEW.type),
      NEW.id || ':ESCROW_LOCK'
    );
  END IF;

  -- Log escrow release/completion
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Release to buyer (user or merchant)
    IF NEW.buyer_merchant_id IS NOT NULL THEN
      -- M2M trade - release to buyer merchant
      PERFORM log_ledger_entry(
        'merchant',
        NEW.buyer_merchant_id,
        'ESCROW_RELEASE',
        NEW.crypto_amount,
        'USDT',
        NEW.id,
        NEW.escrow_tx_hash,
        'Funds received from escrow for order #' || NEW.order_number,
        jsonb_build_object('order_type', NEW.type),
        NEW.id || ':ESCROW_RELEASE'
      );
    ELSIF NEW.type = 'buy' AND NEW.buyer_wallet_address IS NOT NULL THEN
      -- Regular buy order - log for user
      PERFORM log_ledger_entry(
        'user',
        NEW.user_id,
        'ESCROW_RELEASE',
        NEW.crypto_amount,
        'USDT',
        NEW.id,
        NEW.escrow_tx_hash,
        'Funds received for order #' || NEW.order_number,
        jsonb_build_object('order_type', NEW.type),
        NEW.id || ':ESCROW_RELEASE'
      );
    END IF;

    -- Log platform fee using order's protocol_fee_percentage (not hardcoded 0.5%)
    DECLARE
      v_fee_rate DECIMAL(5,4);
      v_platform_fee DECIMAL(20, 8);
    BEGIN
      v_fee_rate := COALESCE(NEW.protocol_fee_percentage, 2.50) / 100.0;
      v_platform_fee := NEW.crypto_amount * v_fee_rate;

      -- Deduct fee from the escrow payer (seller)
      PERFORM log_ledger_entry(
        v_account_type,
        v_account_id,
        'FEE',
        -v_platform_fee,
        'USDT',
        NEW.id,
        NULL,
        'Platform fee for order #' || NEW.order_number,
        jsonb_build_object(
          'fee_rate', (COALESCE(NEW.protocol_fee_percentage, 2.50) || '%'),
          'order_type', NEW.type,
          'spread_preference', COALESCE(NEW.spread_preference, 'fastest')
        ),
        NEW.id || ':FEE'
      );
    END;
  END IF;

  -- Log escrow refund on cancellation
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND NEW.escrow_tx_hash IS NOT NULL THEN
    PERFORM log_ledger_entry(
      v_account_type,
      v_account_id,
      'ESCROW_REFUND',
      NEW.crypto_amount,
      'USDT',
      NEW.id,
      NEW.escrow_tx_hash,
      'Escrow refunded for cancelled order #' || NEW.order_number,
      jsonb_build_object('cancellation_reason', NEW.cancellation_reason),
      NEW.id || ':ESCROW_REFUND'
    );
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: calculate_offer_price(numeric, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_offer_price(p_ref_price numeric, p_premium_bps integer) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  RETURN ROUND(p_ref_price * (1 + p_premium_bps::DECIMAL / 10000), 8);
END;
$$;


--
-- Name: calculate_protocol_fee(numeric, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_protocol_fee(p_crypto_amount numeric, p_spread_preference character varying) RETURNS TABLE(fee_percentage numeric, fee_amount numeric)
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE
      WHEN p_spread_preference = 'best' THEN 2.00
      WHEN p_spread_preference = 'fastest' THEN 2.50
      WHEN p_spread_preference = 'cheap' THEN 1.50
      ELSE 2.50
    END::DECIMAL(5,2) as fee_percentage,
    (p_crypto_amount *
      CASE
        WHEN p_spread_preference = 'best' THEN 0.02
        WHEN p_spread_preference = 'fastest' THEN 0.025
        WHEN p_spread_preference = 'cheap' THEN 0.015
        ELSE 0.025
      END
    )::DECIMAL(20,8) as fee_amount;
END;
$$;


--
-- Name: check_username_unique(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_username_unique() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Check if username exists in users table
  IF EXISTS (
    SELECT 1 FROM users
    WHERE username = NEW.username
    AND (TG_TABLE_NAME != 'users' OR id != NEW.id)
  ) THEN
    RAISE EXCEPTION 'Username already exists';
  END IF;

  -- Check if username exists in merchants table
  IF EXISTS (
    SELECT 1 FROM merchants
    WHERE username = NEW.username
    AND (TG_TABLE_NAME != 'merchants' OR id != NEW.id)
  ) THEN
    RAISE EXCEPTION 'Username already exists';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: create_order_v1(uuid, uuid, uuid, character varying, character varying, numeric, numeric, numeric, jsonb, character varying, uuid, character varying, numeric, numeric, character varying, bigint, character varying, character varying, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_order_v1(p_user_id uuid, p_merchant_id uuid, p_offer_id uuid, p_type character varying, p_payment_method character varying, p_crypto_amount numeric, p_fiat_amount numeric, p_rate numeric, p_payment_details jsonb DEFAULT NULL::jsonb, p_buyer_wallet_address character varying DEFAULT NULL::character varying, p_buyer_merchant_id uuid DEFAULT NULL::uuid, p_spread_preference character varying DEFAULT NULL::character varying, p_protocol_fee_percentage numeric DEFAULT NULL::numeric, p_protocol_fee_amount numeric DEFAULT NULL::numeric, p_escrow_tx_hash character varying DEFAULT NULL::character varying, p_escrow_trade_id bigint DEFAULT NULL::bigint, p_escrow_trade_pda character varying DEFAULT NULL::character varying, p_escrow_pda character varying DEFAULT NULL::character varying, p_escrow_creator_wallet character varying DEFAULT NULL::character varying) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_order RECORD;
  v_status order_status;
BEGIN
  -- Deduct offer liquidity (row lock held until function returns)
  UPDATE merchant_offers
  SET available_amount = available_amount - p_crypto_amount
  WHERE id = p_offer_id AND available_amount >= p_crypto_amount;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_LIQUIDITY');
  END IF;

  v_status := CASE WHEN p_escrow_tx_hash IS NOT NULL THEN 'escrowed'::order_status ELSE 'pending'::order_status END;

  INSERT INTO orders (
    user_id, merchant_id, offer_id, type, payment_method,
    crypto_amount, fiat_amount, crypto_currency, fiat_currency, rate,
    payment_details, status, expires_at,
    buyer_wallet_address, buyer_merchant_id,
    spread_preference, protocol_fee_percentage, protocol_fee_amount,
    escrow_tx_hash, escrowed_at,
    escrow_trade_id, escrow_trade_pda, escrow_pda, escrow_creator_wallet
  ) VALUES (
    p_user_id, p_merchant_id, p_offer_id, p_type::offer_type, p_payment_method::payment_method,
    p_crypto_amount, p_fiat_amount, 'USDC', 'AED', p_rate,
    p_payment_details, v_status, NOW() + INTERVAL '15 minutes',
    p_buyer_wallet_address, p_buyer_merchant_id,
    p_spread_preference, p_protocol_fee_percentage, p_protocol_fee_amount,
    p_escrow_tx_hash,
    CASE WHEN p_escrow_tx_hash IS NOT NULL THEN NOW() ELSE NULL END,
    p_escrow_trade_id, p_escrow_trade_pda, p_escrow_pda, p_escrow_creator_wallet
  ) RETURNING * INTO v_order;

  RETURN jsonb_build_object(
    'success', true,
    'order', row_to_json(v_order)
  );
END;
$$;


--
-- Name: escrow_order_v1(uuid, character varying, character varying, uuid, character varying, bigint, character varying, character varying, character varying, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.escrow_order_v1(p_order_id uuid, p_tx_hash character varying, p_actor_type character varying, p_actor_id uuid, p_escrow_address character varying DEFAULT NULL::character varying, p_escrow_trade_id bigint DEFAULT NULL::bigint, p_escrow_trade_pda character varying DEFAULT NULL::character varying, p_escrow_pda character varying DEFAULT NULL::character varying, p_escrow_creator_wallet character varying DEFAULT NULL::character varying, p_mock_mode boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_order RECORD;
  v_old_status VARCHAR;
  v_amount DECIMAL;
  v_updated RECORD;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  v_old_status := v_order.status::TEXT;

  IF v_order.status NOT IN ('pending'::order_status, 'accepted'::order_status, 'escrow_pending'::order_status) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_STATUS_CHANGED');
  END IF;

  IF v_order.escrow_tx_hash IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_ESCROWED');
  END IF;

  v_amount := v_order.crypto_amount;

  -- Mock mode: deduct seller balance
  IF p_mock_mode THEN
    IF p_actor_type = 'merchant' THEN
      UPDATE merchants SET balance = balance - v_amount
      WHERE id = p_actor_id AND balance >= v_amount;
    ELSE
      UPDATE users SET balance = balance - v_amount
      WHERE id = p_actor_id AND balance >= v_amount;
    END IF;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
    END IF;
  END IF;

  -- Update order with escrow details
  UPDATE orders SET
    escrow_tx_hash = p_tx_hash,
    escrow_address = p_escrow_address,
    escrow_trade_id = p_escrow_trade_id,
    escrow_trade_pda = p_escrow_trade_pda,
    escrow_pda = p_escrow_pda,
    escrow_creator_wallet = p_escrow_creator_wallet,
    escrowed_at = NOW(),
    expires_at = NOW() + INTERVAL '120 minutes',
    status = 'escrowed'::order_status,
    order_version = order_version + 1
  WHERE id = p_order_id
  RETURNING * INTO v_updated;

  RETURN jsonb_build_object(
    'success', true,
    'old_status', v_old_status,
    'order', row_to_json(v_updated)
  );
END;
$$;


--
-- Name: generate_order_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_order_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.order_number := 'BM-' || TO_CHAR(NOW(), 'YYMMDD') || '-' || UPPER(SUBSTR(NEW.id::TEXT, 1, 8));
  RETURN NEW;
END;
$$;


--
-- Name: get_matching_orders(character varying, character varying, numeric, character varying, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_matching_orders(p_order_type character varying, p_payment_method character varying, p_crypto_amount numeric, p_exclude_merchant_id character varying, p_limit integer DEFAULT 10) RETURNS TABLE(order_id character varying, merchant_id character varying, merchant_name character varying, merchant_rating numeric, merchant_total_trades integer, merchant_wallet character varying, crypto_amount numeric, rate numeric, spread_preference character varying, match_priority_score integer, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    v.id,
    v.merchant_id,
    v.merchant_name,
    v.merchant_rating,
    v.merchant_total_trades,
    v.merchant_wallet,
    v.crypto_amount,
    v.rate,
    v.spread_preference,
    v.match_priority_score,
    v.created_at
  FROM v_order_book v
  WHERE v.type = (CASE WHEN p_order_type = 'buy' THEN 'sell' ELSE 'buy' END)
    AND v.payment_method = p_payment_method
    AND v.crypto_amount >= p_crypto_amount * 0.9
    AND v.crypto_amount <= p_crypto_amount * 1.1
    AND v.merchant_id != p_exclude_merchant_id
    AND v.status IN ('pending', 'escrowed')
  ORDER BY v.match_priority_score DESC, v.created_at ASC
  LIMIT p_limit;
END;
$$;


--
-- Name: is_order_mineable(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_order_mineable(p_order_id uuid, p_merchant_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_mineable BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM orders o
    JOIN merchant_quotes mq ON mq.corridor_id = o.corridor_id AND mq.merchant_id = p_merchant_id
    WHERE o.id = p_order_id
      AND o.status = 'pending'
      AND NOW() < o.expires_at
      AND mq.is_online = TRUE
      AND o.crypto_amount >= mq.min_size_usdt
      AND o.crypto_amount <= mq.max_size_usdt
      AND mq.available_liquidity_usdt >= o.crypto_amount
      AND calculate_offer_price(o.ref_price_at_create, o.premium_bps_current) >= mq.min_price_aed_per_usdt
  ) INTO v_mineable;

  RETURN v_mineable;
END;
$$;


--
-- Name: log_ledger_entry(character varying, uuid, character varying, numeric, character varying, uuid, character varying, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_ledger_entry(p_account_type character varying, p_account_id uuid, p_entry_type character varying, p_amount numeric, p_asset character varying DEFAULT 'USDT'::character varying, p_related_order_id uuid DEFAULT NULL::uuid, p_related_tx_hash character varying DEFAULT NULL::character varying, p_description text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_entry_id UUID;
BEGIN
  INSERT INTO ledger_entries (
    account_type,
    account_id,
    entry_type,
    amount,
    asset,
    related_order_id,
    related_tx_hash,
    description,
    metadata
  ) VALUES (
    p_account_type,
    p_account_id,
    p_entry_type,
    p_amount,
    p_asset,
    p_related_order_id,
    p_related_tx_hash,
    p_description,
    p_metadata
  ) RETURNING id INTO v_entry_id;

  RETURN v_entry_id;
END;
$$;


--
-- Name: log_ledger_entry(character varying, uuid, character varying, numeric, character varying, uuid, character varying, text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_ledger_entry(p_account_type character varying, p_account_id uuid, p_entry_type character varying, p_amount numeric, p_asset character varying DEFAULT 'USDT'::character varying, p_related_order_id uuid DEFAULT NULL::uuid, p_related_tx_hash character varying DEFAULT NULL::character varying, p_description text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_entry_id UUID;
BEGIN
  INSERT INTO ledger_entries (
    account_type,
    account_id,
    entry_type,
    amount,
    asset,
    related_order_id,
    related_tx_hash,
    description,
    metadata,
    idempotency_key
  ) VALUES (
    p_account_type,
    p_account_id,
    p_entry_type,
    p_amount,
    p_asset,
    p_related_order_id,
    p_related_tx_hash,
    p_description,
    p_metadata,
    p_idempotency_key
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_entry_id;

  RETURN v_entry_id;
END;
$$;


--
-- Name: release_order_v1(uuid, character varying, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_order_v1(p_order_id uuid, p_tx_hash character varying, p_mock_mode boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_order RECORD;
  v_old_status VARCHAR;
  v_updated RECORD;
  v_amount DECIMAL;
  v_is_buy BOOLEAN;
  v_recipient_id UUID;
  v_recipient_table VARCHAR;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  v_old_status := v_order.status::TEXT;

  -- Idempotency: already released
  IF v_order.release_tx_hash IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_RELEASED');
  END IF;

  -- Status guard: only allow release from valid states
  IF v_old_status NOT IN ('payment_confirmed', 'releasing', 'escrowed', 'payment_sent', 'payment_pending') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
  END IF;

  -- Update order to completed
  UPDATE orders SET
    status = 'completed'::order_status,
    release_tx_hash = p_tx_hash,
    completed_at = NOW(),
    payment_confirmed_at = COALESCE(payment_confirmed_at, NOW()),
    order_version = order_version + 1
  WHERE id = p_order_id
  RETURNING * INTO v_updated;

  -- Mock mode: credit recipient balance
  IF p_mock_mode THEN
    v_amount := v_order.crypto_amount;
    v_is_buy := (v_order.type = 'buy'::offer_type);

    IF v_is_buy THEN
      IF v_order.buyer_merchant_id IS NOT NULL THEN
        v_recipient_id := v_order.buyer_merchant_id;
        v_recipient_table := 'merchants';
      ELSE
        v_recipient_id := v_order.user_id;
        v_recipient_table := 'users';
      END IF;
    ELSE
      IF v_order.buyer_merchant_id IS NOT NULL THEN
        v_recipient_id := v_order.buyer_merchant_id;
      ELSE
        v_recipient_id := v_order.merchant_id;
      END IF;
      v_recipient_table := 'merchants';
    END IF;

    IF v_recipient_table = 'merchants' THEN
      UPDATE merchants SET balance = balance + v_amount WHERE id = v_recipient_id;
    ELSE
      UPDATE users SET balance = balance + v_amount WHERE id = v_recipient_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'old_status', v_old_status,
    'order', row_to_json(v_updated)
  );
END;
$$;


--
-- Name: release_order_v1(uuid, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_order_v1(p_order_id uuid, p_release_tx_hash text, p_released_by_entity_type text, p_released_by_entity_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_order RECORD;
  v_old_status TEXT;
  v_payee_id UUID;
  v_payee_type TEXT;
  v_amount NUMERIC;
BEGIN
  -- Lock the order row
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  v_old_status := v_order.status;

  -- Idempotency: already released
  IF v_order.release_tx_hash IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_RELEASED');
  END IF;

  -- Status guard: only allow release from valid states
  IF v_old_status NOT IN ('payment_confirmed', 'releasing', 'escrowed', 'payment_sent', 'payment_pending') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STATUS');
  END IF;

  -- Determine payee (buyer)
  v_amount := v_order.amount;
  IF v_order.buyer_merchant_id IS NOT NULL THEN
    v_payee_id := v_order.buyer_merchant_id;
    v_payee_type := 'merchant';
  ELSE
    v_payee_id := v_order.user_id;
    v_payee_type := 'user';
  END IF;

  -- Credit buyer balance
  IF v_payee_type = 'merchant' THEN
    UPDATE merchants SET balance = balance + v_amount WHERE id = v_payee_id;
  ELSE
    UPDATE users SET balance = balance + v_amount WHERE id = v_payee_id;
  END IF;

  -- Update order
  UPDATE orders SET
    status = 'completed',
    release_tx_hash = p_release_tx_hash,
    released_at = NOW(),
    updated_at = NOW()
  WHERE id = p_order_id;

  -- Insert ledger entry
  INSERT INTO ledger_entries (order_id, entry_type, amount, entity_type, entity_id, tx_hash, created_at)
  VALUES (p_order_id, 'escrow_release', v_amount, v_payee_type, v_payee_id, p_release_tx_hash, NOW());

  -- Insert order event
  INSERT INTO order_events (order_id, event_type, old_status, new_status, actor_type, actor_id, metadata, created_at)
  VALUES (p_order_id, 'release', v_old_status, 'completed', p_released_by_entity_type, p_released_by_entity_id,
    jsonb_build_object('tx_hash', p_release_tx_hash, 'amount', v_amount, 'payee_type', v_payee_type, 'payee_id', v_payee_id),
    NOW());

  RETURN jsonb_build_object(
    'success', true,
    'old_status', v_old_status,
    'new_status', 'completed',
    'amount', v_amount,
    'payee_type', v_payee_type,
    'payee_id', v_payee_id
  );
END;
$$;


--
-- Name: touch_order_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_order_activity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Update last_activity_at on any status change or payment timestamp update
  IF (OLD.status IS DISTINCT FROM NEW.status)
     OR (OLD.payment_sent_at IS DISTINCT FROM NEW.payment_sent_at)
     OR (OLD.payment_confirmed_at IS DISTINCT FROM NEW.payment_confirmed_at)
     OR (OLD.accepted_at IS DISTINCT FROM NEW.accepted_at)
     OR (OLD.extension_requested_by IS DISTINCT FROM NEW.extension_requested_by)
  THEN
    NEW.last_activity_at = NOW();
  END IF;

  -- Auto-set disputed_at and auto-resolve deadline when entering disputed
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'disputed' THEN
    NEW.disputed_at = NOW();
    NEW.dispute_auto_resolve_at = NOW() + INTERVAL '24 hours';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: touch_order_activity_on_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_order_activity_on_message() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE orders
  SET last_activity_at = NOW()
  WHERE id = NEW.order_id
    AND status NOT IN ('completed', 'cancelled', 'expired');
  RETURN NEW;
END;
$$;


--
-- Name: update_aggregate_rating(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_aggregate_rating() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Update user aggregate rating
  IF NEW.rated_type = 'user' THEN
    UPDATE users
    SET
      total_rating_sum = COALESCE(total_rating_sum, 0) + NEW.rating,
      rating_count = COALESCE(rating_count, 0) + 1,
      rating = ROUND((COALESCE(total_rating_sum, 0) + NEW.rating)::DECIMAL / (COALESCE(rating_count, 0) + 1), 2)
    WHERE id = NEW.rated_id;
  END IF;

  -- Update merchant aggregate rating
  IF NEW.rated_type = 'merchant' THEN
    UPDATE merchants
    SET
      total_rating_sum = COALESCE(total_rating_sum, 0) + NEW.rating,
      rating_count = COALESCE(rating_count, 0) + 1,
      rating = ROUND((COALESCE(total_rating_sum, 0) + NEW.rating)::DECIMAL / (COALESCE(rating_count, 0) + 1), 2)
    WHERE id = NEW.rated_id;
  END IF;

  -- Update order rating columns
  IF NEW.rater_type = 'merchant' THEN
    UPDATE orders
    SET merchant_rating = NEW.rating, merchant_rated_at = NEW.created_at
    WHERE id = NEW.order_id;
  ELSIF NEW.rater_type = 'user' THEN
    UPDATE orders
    SET user_rating = NEW.rating, user_rated_at = NEW.created_at
    WHERE id = NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: update_merchant_rating(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_merchant_rating() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.reviewee_type = 'merchant' THEN
    UPDATE merchants
    SET rating = (
      SELECT ROUND(AVG(rating)::numeric, 1)
      FROM reviews
      WHERE reviewee_type = 'merchant' AND reviewee_id = NEW.reviewee_id
    ),
    rating_count = (
      SELECT COUNT(*)
      FROM reviews
      WHERE reviewee_type = 'merchant' AND reviewee_id = NEW.reviewee_id
    )
    WHERE id = NEW.reviewee_id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_user_rating(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_user_rating() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.reviewee_type = 'user' THEN
    UPDATE users
    SET rating = (
      SELECT ROUND(AVG(rating)::numeric, 1)
      FROM reviews
      WHERE reviewee_type = 'user' AND reviewee_id = NEW.reviewee_id
    )
    WHERE id = NEW.reviewee_id;
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now()
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    sender_type public.actor_type NOT NULL,
    sender_id uuid,
    message_type public.message_type DEFAULT 'text'::public.message_type,
    content text NOT NULL,
    image_url text,
    is_read boolean DEFAULT false,
    read_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: compliance_team; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_team (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    role character varying(50) DEFAULT 'support'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: corridor_fulfillments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corridor_fulfillments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    provider_merchant_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    saed_amount_locked bigint NOT NULL,
    fiat_amount numeric(20,6) NOT NULL,
    corridor_fee bigint DEFAULT 0 NOT NULL,
    provider_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    bank_details jsonb,
    send_deadline timestamp with time zone NOT NULL,
    idempotency_key character varying(255),
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_sent_at timestamp with time zone,
    completed_at timestamp with time zone,
    failed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT corridor_fulfillments_corridor_fee_check CHECK ((corridor_fee >= 0)),
    CONSTRAINT corridor_fulfillments_fiat_amount_check CHECK ((fiat_amount > (0)::numeric)),
    CONSTRAINT corridor_fulfillments_provider_status_check CHECK (((provider_status)::text = ANY ((ARRAY['pending'::character varying, 'payment_sent'::character varying, 'completed'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT corridor_fulfillments_saed_amount_locked_check CHECK ((saed_amount_locked > 0))
);


--
-- Name: corridor_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corridor_prices (
    corridor_id character varying(20) NOT NULL,
    ref_price numeric(20,8) NOT NULL,
    volume_5m numeric(20,2) DEFAULT 0,
    avg_fill_time_sec integer DEFAULT 0,
    active_merchants_count integer DEFAULT 0,
    updated_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now(),
    price_authority_pubkey text,
    confidence character varying(10) DEFAULT 'low'::character varying
);


--
-- Name: corridor_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corridor_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merchant_id uuid NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    fee_percentage numeric(5,2) DEFAULT 0.50 NOT NULL,
    min_amount numeric(20,6) DEFAULT 100 NOT NULL,
    max_amount numeric(20,6) DEFAULT 50000 NOT NULL,
    auto_accept boolean DEFAULT true NOT NULL,
    available_hours_start time without time zone,
    available_hours_end time without time zone,
    total_fulfillments integer DEFAULT 0 NOT NULL,
    total_volume numeric(20,6) DEFAULT 0 NOT NULL,
    avg_fulfillment_time_sec integer,
    last_fulfillment_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT corridor_providers_fee_percentage_check CHECK (((fee_percentage >= (0)::numeric) AND (fee_percentage <= (10)::numeric))),
    CONSTRAINT corridor_providers_max_amount_check CHECK ((max_amount > (0)::numeric)),
    CONSTRAINT corridor_providers_min_amount_check CHECK ((min_amount > (0)::numeric))
);


--
-- Name: direct_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.direct_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    sender_type character varying(20) NOT NULL,
    sender_id uuid NOT NULL,
    recipient_type character varying(20) NOT NULL,
    recipient_id uuid NOT NULL,
    content text NOT NULL,
    message_type character varying(20) DEFAULT 'text'::character varying,
    image_url text,
    is_read boolean DEFAULT false,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT direct_messages_message_type_check CHECK (((message_type)::text = ANY ((ARRAY['text'::character varying, 'image'::character varying])::text[]))),
    CONSTRAINT direct_messages_recipient_type_check CHECK (((recipient_type)::text = ANY ((ARRAY['merchant'::character varying, 'user'::character varying])::text[]))),
    CONSTRAINT direct_messages_sender_type_check CHECK (((sender_type)::text = ANY ((ARRAY['merchant'::character varying, 'user'::character varying])::text[])))
);


--
-- Name: disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disputes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    raised_by public.actor_type NOT NULL,
    raiser_id uuid NOT NULL,
    reason public.dispute_reason NOT NULL,
    description text,
    evidence_urls text[],
    status public.dispute_status DEFAULT 'open'::public.dispute_status,
    resolution text,
    resolved_in_favor_of public.actor_type,
    created_at timestamp without time zone DEFAULT now(),
    resolved_at timestamp without time zone,
    proposed_resolution character varying(50),
    proposed_by uuid,
    proposed_at timestamp with time zone,
    user_confirmed boolean DEFAULT false,
    merchant_confirmed boolean DEFAULT false,
    split_percentage jsonb,
    initiated_by character varying(50),
    resolution_notes text,
    assigned_to uuid,
    assigned_at timestamp without time zone
);


--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_keys (
    key text NOT NULL,
    route text NOT NULL,
    order_id uuid,
    request_hash text,
    status text DEFAULT 'in_progress'::text NOT NULL,
    response_code integer,
    response_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval)
);


--
-- Name: ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger_entries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    account_type character varying(20) NOT NULL,
    account_id uuid NOT NULL,
    entry_type character varying(30) NOT NULL,
    amount numeric(20,8) NOT NULL,
    asset character varying(10) DEFAULT 'USDT'::character varying NOT NULL,
    related_order_id uuid,
    related_tx_hash character varying(255),
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    balance_before numeric(20,8),
    balance_after numeric(20,8),
    created_at timestamp without time zone DEFAULT now(),
    idempotency_key text,
    CONSTRAINT ledger_entries_account_type_check CHECK (((account_type)::text = ANY ((ARRAY['merchant'::character varying, 'user'::character varying])::text[]))),
    CONSTRAINT ledger_entries_entry_type_check CHECK (((entry_type)::text = ANY ((ARRAY['DEPOSIT'::character varying, 'WITHDRAWAL'::character varying, 'ESCROW_LOCK'::character varying, 'ESCROW_RELEASE'::character varying, 'ESCROW_REFUND'::character varying, 'FEE'::character varying, 'FEE_EARNING'::character varying, 'ADJUSTMENT'::character varying, 'ORDER_PAYMENT'::character varying, 'ORDER_RECEIPT'::character varying, 'SYNTHETIC_CONVERSION'::character varying, 'CORRIDOR_SAED_LOCK'::character varying, 'CORRIDOR_SAED_TRANSFER'::character varying, 'CORRIDOR_FEE'::character varying])::text[])))
);


--
-- Name: merchant_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_contacts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    merchant_id uuid NOT NULL,
    user_id uuid,
    contact_merchant_id uuid,
    contact_type character varying(20) DEFAULT 'user'::character varying,
    nickname character varying(100),
    notes text,
    is_favorite boolean DEFAULT false,
    trades_count integer DEFAULT 0,
    total_volume numeric(20,2) DEFAULT 0,
    last_trade_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT merchant_contacts_check CHECK (((((contact_type)::text = 'user'::text) AND (user_id IS NOT NULL) AND (contact_merchant_id IS NULL)) OR (((contact_type)::text = 'merchant'::text) AND (contact_merchant_id IS NOT NULL) AND (user_id IS NULL))))
);


--
-- Name: merchant_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_offers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    merchant_id uuid,
    type public.offer_type NOT NULL,
    payment_method public.payment_method NOT NULL,
    rate numeric(10,4) NOT NULL,
    rate_type public.rate_type DEFAULT 'fixed'::public.rate_type,
    margin_percent numeric(5,2),
    min_amount numeric(20,2) NOT NULL,
    max_amount numeric(20,2) NOT NULL,
    available_amount numeric(20,2) NOT NULL,
    bank_name character varying(100),
    bank_account_name character varying(100),
    bank_iban character varying(34),
    location_name character varying(100),
    location_address text,
    location_lat numeric(10,7),
    location_lng numeric(10,7),
    meeting_instructions text,
    is_active boolean DEFAULT true,
    requires_kyc_level integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT offers_amount_check CHECK ((min_amount <= max_amount)),
    CONSTRAINT offers_available_positive CHECK ((available_amount >= (0)::numeric)),
    CONSTRAINT offers_rate_positive CHECK ((rate > (0)::numeric))
);


--
-- Name: merchant_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_quotes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    merchant_id uuid NOT NULL,
    corridor_id character varying(20) DEFAULT 'USDT_AED'::character varying NOT NULL,
    min_price_aed_per_usdt numeric(20,8) NOT NULL,
    min_size_usdt numeric(20,2) DEFAULT 10,
    max_size_usdt numeric(20,2) DEFAULT 10000,
    sla_minutes integer DEFAULT 15,
    available_liquidity_usdt numeric(20,2) DEFAULT 0,
    is_online boolean DEFAULT true,
    updated_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: merchant_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merchant_id uuid,
    user_id uuid,
    order_id uuid,
    type character varying(50) NOT NULL,
    amount numeric(18,6) NOT NULL,
    balance_before numeric(18,6) DEFAULT 0 NOT NULL,
    balance_after numeric(18,6) DEFAULT 0 NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT check_merchant_or_user CHECK ((((merchant_id IS NOT NULL) AND (user_id IS NULL)) OR ((merchant_id IS NULL) AND (user_id IS NOT NULL))))
);


--
-- Name: merchants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchants (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    wallet_address character varying(64),
    business_name character varying(100) NOT NULL,
    display_name character varying(50) NOT NULL,
    email character varying(255),
    phone character varying(20),
    avatar_url text,
    status public.merchant_status DEFAULT 'pending'::public.merchant_status,
    verification_level integer DEFAULT 1,
    total_trades integer DEFAULT 0,
    total_volume numeric(20,2) DEFAULT 0,
    rating numeric(2,1) DEFAULT 5.0,
    rating_count integer DEFAULT 0,
    avg_response_time_mins integer DEFAULT 5,
    is_online boolean DEFAULT false,
    last_seen_at timestamp without time zone,
    auto_accept_enabled boolean DEFAULT false,
    auto_accept_max_amount numeric(20,2),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    balance numeric(20,6) DEFAULT 0,
    password_hash character varying(255),
    username character varying(50),
    big_order_threshold numeric(20,2) DEFAULT 10000,
    total_rating_sum integer DEFAULT 0,
    sinr_balance bigint DEFAULT 0 NOT NULL,
    max_sinr_exposure bigint,
    synthetic_rate numeric(10,4) DEFAULT 3.6700 NOT NULL,
    telegram_chat_id text,
    bio text,
    CONSTRAINT merchants_max_sinr_exposure_check CHECK (((max_sinr_exposure IS NULL) OR (max_sinr_exposure >= 0))),
    CONSTRAINT merchants_rating_range CHECK (((rating >= (0)::numeric) AND (rating <= (5)::numeric))),
    CONSTRAINT merchants_sinr_balance_check CHECK ((sinr_balance >= 0)),
    CONSTRAINT merchants_synthetic_rate_check CHECK ((synthetic_rate > (0)::numeric))
);


--
-- Name: messages; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.messages AS
 SELECT chat_messages.id,
    chat_messages.order_id,
    chat_messages.sender_type,
    chat_messages.sender_id,
    chat_messages.message_type,
    chat_messages.content,
    chat_messages.image_url,
    chat_messages.is_read,
    chat_messages.read_at,
    chat_messages.created_at
   FROM public.chat_messages;


--
-- Name: notification_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type character varying(50) NOT NULL,
    order_id uuid NOT NULL,
    payload jsonb NOT NULL,
    attempts integer DEFAULT 0,
    max_attempts integer DEFAULT 5,
    status character varying(20) DEFAULT 'pending'::character varying,
    last_attempt_at timestamp without time zone,
    last_error text,
    created_at timestamp without time zone DEFAULT now(),
    sent_at timestamp without time zone
);


--
-- Name: order_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    event_type character varying(50) NOT NULL,
    actor_type public.actor_type NOT NULL,
    actor_id uuid,
    old_status public.order_status,
    new_status public.order_status,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now(),
    request_id text
);


--
-- Name: order_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid,
    previous_status character varying(50),
    new_status character varying(50) NOT NULL,
    actor_type character varying(50),
    actor_id character varying(255),
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_number character varying(20) NOT NULL,
    user_id uuid,
    merchant_id uuid,
    offer_id uuid,
    type public.offer_type NOT NULL,
    payment_method public.payment_method NOT NULL,
    crypto_amount numeric(20,6) NOT NULL,
    crypto_currency character varying(10) DEFAULT 'USDC'::character varying,
    fiat_amount numeric(20,2) NOT NULL,
    fiat_currency character varying(10) DEFAULT 'AED'::character varying,
    rate numeric(10,4) NOT NULL,
    platform_fee numeric(20,6) DEFAULT 0,
    network_fee numeric(20,6) DEFAULT 0,
    status public.order_status DEFAULT 'pending'::public.order_status,
    escrow_tx_hash character varying(128),
    escrow_address character varying(64),
    release_tx_hash character varying(128),
    payment_details jsonb,
    created_at timestamp without time zone DEFAULT now(),
    accepted_at timestamp without time zone,
    escrowed_at timestamp without time zone,
    payment_sent_at timestamp without time zone,
    payment_confirmed_at timestamp without time zone,
    completed_at timestamp without time zone,
    cancelled_at timestamp without time zone,
    expires_at timestamp without time zone,
    cancelled_by public.actor_type,
    cancellation_reason text,
    escrow_trade_id bigint,
    escrow_trade_pda character varying(64),
    escrow_pda character varying(64),
    escrow_creator_wallet character varying(64),
    refund_tx_hash character varying(128),
    buyer_wallet_address character varying(64),
    is_custom boolean DEFAULT false,
    custom_notes text,
    premium_percent numeric(5,2) DEFAULT 0,
    extension_count integer DEFAULT 0,
    max_extensions integer DEFAULT 3,
    extension_requested_by public.actor_type,
    extension_requested_at timestamp without time zone,
    last_extended_at timestamp without time zone,
    acceptor_wallet_address character varying(64),
    has_manual_message boolean DEFAULT false,
    buyer_merchant_id uuid,
    spread_preference character varying(20) DEFAULT 'fastest'::character varying,
    protocol_fee_percentage numeric(5,2) DEFAULT 2.50,
    protocol_fee_amount numeric(20,8),
    merchant_spread_percentage numeric(5,2),
    is_auto_cancelled boolean DEFAULT false,
    merchant_rated_at timestamp without time zone,
    user_rated_at timestamp without time zone,
    merchant_rating integer,
    user_rating integer,
    corridor_id character varying(20) DEFAULT 'USDT_AED'::character varying,
    side character varying(10) DEFAULT 'BUY'::character varying,
    ref_price_at_create numeric(20,8),
    premium_bps_current integer DEFAULT 0,
    premium_bps_cap integer DEFAULT 500,
    bump_step_bps integer DEFAULT 10,
    bump_interval_sec integer DEFAULT 30,
    auto_bump_enabled boolean DEFAULT false,
    winner_merchant_id uuid,
    next_bump_at timestamp without time zone,
    order_version integer DEFAULT 1 NOT NULL,
    escrow_debited_entity_type character varying(20),
    escrow_debited_entity_id uuid,
    escrow_debited_amount numeric(20,8),
    escrow_debited_at timestamp with time zone,
    payment_via character varying(20) DEFAULT 'bank'::character varying,
    corridor_fulfillment_id uuid,
    price_proof_sig text,
    price_proof_ref_price numeric(20,8),
    price_proof_expires_at timestamp without time zone,
    cancel_requested_by character varying(20),
    cancel_requested_at timestamp with time zone,
    cancel_request_reason text,
    last_activity_at timestamp with time zone,
    inactivity_warned_at timestamp with time zone,
    disputed_at timestamp with time zone,
    dispute_auto_resolve_at timestamp with time zone,
    extension_minutes integer DEFAULT 15,
    CONSTRAINT check_spread_preference CHECK (((spread_preference)::text = ANY ((ARRAY['best'::character varying, 'fastest'::character varying, 'cheap'::character varying])::text[]))),
    CONSTRAINT orders_crypto_positive CHECK ((crypto_amount > (0)::numeric)),
    CONSTRAINT orders_escrow_debited_entity_type_check CHECK (((escrow_debited_entity_type)::text = ANY ((ARRAY['merchant'::character varying, 'user'::character varying])::text[]))),
    CONSTRAINT orders_fiat_positive CHECK ((fiat_amount > (0)::numeric)),
    CONSTRAINT orders_merchant_rating_check CHECK (((merchant_rating >= 1) AND (merchant_rating <= 5))),
    CONSTRAINT orders_payment_via_check CHECK (((payment_via)::text = ANY ((ARRAY['bank'::character varying, 'saed_corridor'::character varying])::text[]))),
    CONSTRAINT orders_rate_positive CHECK ((rate > (0)::numeric)),
    CONSTRAINT orders_user_rating_check CHECK (((user_rating >= 1) AND (user_rating <= 5)))
);


--
-- Name: platform_balance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_balance (
    id integer NOT NULL,
    key character varying(50) DEFAULT 'main'::character varying NOT NULL,
    balance numeric(20,8) DEFAULT 0 NOT NULL,
    total_fees_collected numeric(20,8) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: platform_balance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.platform_balance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: platform_balance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.platform_balance_id_seq OWNED BY public.platform_balance.id;


--
-- Name: platform_fee_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_fee_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid,
    fee_amount numeric(20,8) NOT NULL,
    fee_percentage numeric(5,2) NOT NULL,
    spread_preference character varying(20),
    platform_balance_after numeric(20,8) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ratings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    rater_type character varying(20) NOT NULL,
    rater_id uuid NOT NULL,
    rated_type character varying(20) NOT NULL,
    rated_id uuid NOT NULL,
    rating integer NOT NULL,
    review_text text,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT ratings_rated_type_check CHECK (((rated_type)::text = ANY ((ARRAY['merchant'::character varying, 'user'::character varying])::text[]))),
    CONSTRAINT ratings_rater_type_check CHECK (((rater_type)::text = ANY ((ARRAY['merchant'::character varying, 'user'::character varying])::text[]))),
    CONSTRAINT ratings_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: reputation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reputation_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_id uuid NOT NULL,
    entity_type character varying(20) NOT NULL,
    event_type character varying(50) NOT NULL,
    score_change integer DEFAULT 0 NOT NULL,
    reason text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reputation_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reputation_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_id uuid NOT NULL,
    entity_type character varying(20) NOT NULL,
    total_score integer NOT NULL,
    review_score integer NOT NULL,
    execution_score integer NOT NULL,
    volume_score integer NOT NULL,
    consistency_score integer NOT NULL,
    trust_score integer NOT NULL,
    tier character varying(20) NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reputation_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reputation_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_id uuid NOT NULL,
    entity_type character varying(20) NOT NULL,
    total_score integer DEFAULT 0 NOT NULL,
    review_score integer DEFAULT 50 NOT NULL,
    execution_score integer DEFAULT 50 NOT NULL,
    volume_score integer DEFAULT 0 NOT NULL,
    consistency_score integer DEFAULT 0 NOT NULL,
    trust_score integer DEFAULT 50 NOT NULL,
    tier character varying(20) DEFAULT 'newcomer'::character varying NOT NULL,
    badges text[] DEFAULT '{}'::text[],
    calculated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reputation_scores_entity_type_check CHECK (((entity_type)::text = ANY ((ARRAY['user'::character varying, 'merchant'::character varying])::text[])))
);


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    reviewer_type public.actor_type NOT NULL,
    reviewer_id uuid NOT NULL,
    reviewee_type public.actor_type NOT NULL,
    reviewee_id uuid NOT NULL,
    rating integer NOT NULL,
    comment text,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: synthetic_conversions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.synthetic_conversions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    account_type character varying(20) NOT NULL,
    account_id uuid NOT NULL,
    direction character varying(20) NOT NULL,
    amount_in bigint NOT NULL,
    amount_out bigint NOT NULL,
    rate numeric(10,4) NOT NULL,
    usdt_balance_before numeric(20,6) NOT NULL,
    usdt_balance_after numeric(20,6) NOT NULL,
    sinr_balance_before bigint NOT NULL,
    sinr_balance_after bigint NOT NULL,
    idempotency_key character varying(255),
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT synthetic_conversions_account_type_check CHECK (((account_type)::text = ANY ((ARRAY['merchant'::character varying, 'user'::character varying])::text[]))),
    CONSTRAINT synthetic_conversions_amount_in_check CHECK ((amount_in > 0)),
    CONSTRAINT synthetic_conversions_amount_out_check CHECK ((amount_out > 0)),
    CONSTRAINT synthetic_conversions_direction_check CHECK (((direction)::text = ANY ((ARRAY['usdt_to_sinr'::character varying, 'sinr_to_usdt'::character varying])::text[]))),
    CONSTRAINT synthetic_conversions_rate_check CHECK ((rate > (0)::numeric))
);


--
-- Name: user_bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_bank_accounts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    bank_name character varying(100) NOT NULL,
    account_name character varying(100) NOT NULL,
    iban character varying(34) NOT NULL,
    is_default boolean DEFAULT false,
    is_verified boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    wallet_address character varying(64),
    name character varying(100),
    email character varying(255),
    phone character varying(20),
    avatar_url text,
    kyc_status public.kyc_status DEFAULT 'none'::public.kyc_status,
    kyc_level integer DEFAULT 0,
    total_trades integer DEFAULT 0,
    total_volume numeric(20,2) DEFAULT 0,
    rating numeric(2,1) DEFAULT 5.0,
    push_token text,
    notification_settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    balance numeric(20,6) DEFAULT 0,
    username character varying(50),
    password_hash text,
    rating_count integer DEFAULT 0,
    total_rating_sum integer DEFAULT 0,
    sinr_balance bigint DEFAULT 0 NOT NULL,
    CONSTRAINT users_rating_range CHECK (((rating >= (0)::numeric) AND (rating <= (5)::numeric))),
    CONSTRAINT users_sinr_balance_check CHECK ((sinr_balance >= 0))
);


--
-- Name: v_mempool_orders; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_mempool_orders AS
 SELECT o.id,
    o.order_number,
    o.corridor_id,
    o.side,
    o.crypto_amount AS amount_usdt,
    o.ref_price_at_create,
    o.premium_bps_current,
    o.premium_bps_cap,
    o.bump_step_bps,
    o.bump_interval_sec,
    o.auto_bump_enabled,
    o.next_bump_at,
    public.calculate_offer_price(o.ref_price_at_create, o.premium_bps_current) AS current_offer_price,
    public.calculate_offer_price(o.ref_price_at_create, o.premium_bps_cap) AS max_offer_price,
    o.expires_at,
    (EXTRACT(epoch FROM ((o.expires_at)::timestamp with time zone - now())))::integer AS seconds_until_expiry,
    o.user_id,
    o.merchant_id AS creator_merchant_id,
    u.username AS creator_username,
    o.created_at,
    o.status
   FROM (public.orders o
     LEFT JOIN public.users u ON ((o.user_id = u.id)))
  WHERE ((o.status = 'pending'::public.order_status) AND (now() < o.expires_at) AND ((o.auto_bump_enabled = true) OR (o.premium_bps_current > 0)))
  ORDER BY o.premium_bps_current DESC, o.created_at;


--
-- Name: v_merchant_ledger; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_merchant_ledger AS
 SELECT le.id,
    le.account_id AS merchant_id,
    le.entry_type,
    le.amount,
    le.asset,
    le.related_order_id,
    le.related_tx_hash,
    le.description,
    le.metadata,
    le.created_at,
    o.order_number,
    o.type AS order_type,
    o.status AS order_status,
        CASE
            WHEN (o.type = 'buy'::public.offer_type) THEN COALESCE(( SELECT merchants.display_name
               FROM public.merchants
              WHERE (merchants.id = o.buyer_merchant_id)), ( SELECT users.username
               FROM public.users
              WHERE (users.id = o.user_id)), 'Unknown'::character varying)
            WHEN (o.type = 'sell'::public.offer_type) THEN COALESCE(( SELECT merchants.display_name
               FROM public.merchants
              WHERE (merchants.id = o.merchant_id)), 'Unknown'::character varying)
            ELSE NULL::character varying
        END AS counterparty_name
   FROM (public.ledger_entries le
     LEFT JOIN public.orders o ON ((le.related_order_id = o.id)))
  WHERE ((le.account_type)::text = 'merchant'::text)
  ORDER BY le.created_at DESC;


--
-- Name: v_order_book; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_order_book AS
 SELECT o.id,
    o.order_number,
    o.user_id,
    o.merchant_id,
    o.offer_id,
    o.type,
    o.payment_method,
    o.crypto_amount,
    o.crypto_currency,
    o.fiat_amount,
    o.fiat_currency,
    o.rate,
    o.platform_fee,
    o.network_fee,
    o.status,
    o.escrow_tx_hash,
    o.escrow_address,
    o.release_tx_hash,
    o.payment_details,
    o.created_at,
    o.accepted_at,
    o.escrowed_at,
    o.payment_sent_at,
    o.payment_confirmed_at,
    o.completed_at,
    o.cancelled_at,
    o.expires_at,
    o.cancelled_by,
    o.cancellation_reason,
    o.escrow_trade_id,
    o.escrow_trade_pda,
    o.escrow_pda,
    o.escrow_creator_wallet,
    o.refund_tx_hash,
    o.buyer_wallet_address,
    o.is_custom,
    o.custom_notes,
    o.premium_percent,
    o.extension_count,
    o.max_extensions,
    o.extension_requested_by,
    o.extension_requested_at,
    o.last_extended_at,
    o.acceptor_wallet_address,
    o.has_manual_message,
    o.buyer_merchant_id,
    o.spread_preference,
    o.protocol_fee_percentage,
    o.protocol_fee_amount,
    o.merchant_spread_percentage,
    o.is_auto_cancelled,
    m.display_name AS merchant_name,
    m.rating AS merchant_rating,
    m.total_trades AS merchant_total_trades,
    m.avg_response_time_mins AS merchant_response_time,
    m.wallet_address AS merchant_wallet,
    (((
        CASE
            WHEN ((o.spread_preference)::text = 'best'::text) THEN 100
            WHEN ((o.spread_preference)::text = 'fastest'::text) THEN 75
            WHEN ((o.spread_preference)::text = 'cheap'::text) THEN 50
            ELSE 0
        END)::numeric + (m.rating * (10)::numeric)) + (
        CASE
            WHEN (m.avg_response_time_mins < 5) THEN 20
            ELSE 0
        END)::numeric) AS match_priority_score
   FROM (public.orders o
     JOIN public.merchants m ON ((o.merchant_id = m.id)))
  WHERE (o.status = ANY (ARRAY['pending'::public.order_status, 'escrowed'::public.order_status]))
  ORDER BY (((
        CASE
            WHEN ((o.spread_preference)::text = 'best'::text) THEN 100
            WHEN ((o.spread_preference)::text = 'fastest'::text) THEN 75
            WHEN ((o.spread_preference)::text = 'cheap'::text) THEN 50
            ELSE 0
        END)::numeric + (m.rating * (10)::numeric)) + (
        CASE
            WHEN (m.avg_response_time_mins < 5) THEN 20
            ELSE 0
        END)::numeric) DESC, o.created_at;


--
-- Name: v_top_rated_sellers; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_top_rated_sellers AS
 SELECT m.id,
    m.username,
    m.display_name,
    m.rating,
    m.rating_count,
    m.total_trades,
    m.wallet_address,
    m.created_at,
    rank() OVER (ORDER BY m.rating DESC, m.rating_count DESC) AS rank
   FROM public.merchants m
  WHERE ((m.status = 'active'::public.merchant_status) AND (m.rating_count >= 3))
  ORDER BY m.rating DESC, m.rating_count DESC
 LIMIT 10;


--
-- Name: v_top_rated_users; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_top_rated_users AS
 SELECT u.id,
    u.username,
    u.rating,
    u.rating_count,
    u.total_trades,
    u.wallet_address,
    u.created_at,
    rank() OVER (ORDER BY u.rating DESC, u.rating_count DESC) AS rank
   FROM public.users u
  WHERE (u.rating_count >= 3)
  ORDER BY u.rating DESC, u.rating_count DESC
 LIMIT 10;


--
-- Name: v_user_ledger; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_user_ledger AS
 SELECT le.id,
    le.account_id AS user_id,
    le.entry_type,
    le.amount,
    le.asset,
    le.related_order_id,
    le.related_tx_hash,
    le.description,
    le.metadata,
    le.created_at,
    o.order_number,
    o.type AS order_type,
    o.status AS order_status
   FROM (public.ledger_entries le
     LEFT JOIN public.orders o ON ((le.related_order_id = o.id)))
  WHERE ((le.account_type)::text = 'user'::text)
  ORDER BY le.created_at DESC;


--
-- Name: platform_balance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_balance ALTER COLUMN id SET DEFAULT nextval('public.platform_balance_id_seq'::regclass);


--
-- Name: _migrations _migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations
    ADD CONSTRAINT _migrations_pkey PRIMARY KEY (name);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: compliance_team compliance_team_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_team
    ADD CONSTRAINT compliance_team_email_key UNIQUE (email);


--
-- Name: compliance_team compliance_team_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_team
    ADD CONSTRAINT compliance_team_pkey PRIMARY KEY (id);


--
-- Name: corridor_fulfillments corridor_fulfillments_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corridor_fulfillments
    ADD CONSTRAINT corridor_fulfillments_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: corridor_fulfillments corridor_fulfillments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corridor_fulfillments
    ADD CONSTRAINT corridor_fulfillments_pkey PRIMARY KEY (id);


--
-- Name: corridor_prices corridor_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corridor_prices
    ADD CONSTRAINT corridor_prices_pkey PRIMARY KEY (corridor_id);


--
-- Name: corridor_providers corridor_providers_merchant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corridor_providers
    ADD CONSTRAINT corridor_providers_merchant_id_key UNIQUE (merchant_id);


--
-- Name: corridor_providers corridor_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corridor_providers
    ADD CONSTRAINT corridor_providers_pkey PRIMARY KEY (id);


--
-- Name: direct_messages direct_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_messages
    ADD CONSTRAINT direct_messages_pkey PRIMARY KEY (id);


--
-- Name: disputes disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_pkey PRIMARY KEY (id);


--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (key);


--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: merchant_contacts merchant_contacts_merchant_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_contacts
    ADD CONSTRAINT merchant_contacts_merchant_id_user_id_key UNIQUE (merchant_id, user_id);


--
-- Name: merchant_contacts merchant_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_contacts
    ADD CONSTRAINT merchant_contacts_pkey PRIMARY KEY (id);


--
-- Name: merchant_offers merchant_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_offers
    ADD CONSTRAINT merchant_offers_pkey PRIMARY KEY (id);


--
-- Name: merchant_quotes merchant_quotes_merchant_id_corridor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_quotes
    ADD CONSTRAINT merchant_quotes_merchant_id_corridor_id_key UNIQUE (merchant_id, corridor_id);


--
-- Name: merchant_quotes merchant_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_quotes
    ADD CONSTRAINT merchant_quotes_pkey PRIMARY KEY (id);


--
-- Name: merchant_transactions merchant_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_transactions
    ADD CONSTRAINT merchant_transactions_pkey PRIMARY KEY (id);


--
-- Name: merchants merchants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchants
    ADD CONSTRAINT merchants_pkey PRIMARY KEY (id);


--
-- Name: merchants merchants_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchants
    ADD CONSTRAINT merchants_username_key UNIQUE (username);


--
-- Name: merchants merchants_wallet_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchants
    ADD CONSTRAINT merchants_wallet_address_key UNIQUE (wallet_address);


--
-- Name: notification_outbox notification_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_pkey PRIMARY KEY (id);


--
-- Name: order_events order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_pkey PRIMARY KEY (id);


--
-- Name: order_status_history order_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_pkey PRIMARY KEY (id);


--
-- Name: orders orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: platform_balance platform_balance_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_balance
    ADD CONSTRAINT platform_balance_key_key UNIQUE (key);


--
-- Name: platform_balance platform_balance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_balance
    ADD CONSTRAINT platform_balance_pkey PRIMARY KEY (id);


--
-- Name: platform_fee_transactions platform_fee_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_fee_transactions
    ADD CONSTRAINT platform_fee_transactions_pkey PRIMARY KEY (id);


--
-- Name: ratings ratings_order_id_rater_type_rater_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_order_id_rater_type_rater_id_key UNIQUE (order_id, rater_type, rater_id);


--
-- Name: ratings ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_pkey PRIMARY KEY (id);


--
-- Name: reputation_events reputation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reputation_events
    ADD CONSTRAINT reputation_events_pkey PRIMARY KEY (id);


--
-- Name: reputation_history reputation_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reputation_history
    ADD CONSTRAINT reputation_history_pkey PRIMARY KEY (id);


--
-- Name: reputation_scores reputation_scores_entity_id_entity_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reputation_scores
    ADD CONSTRAINT reputation_scores_entity_id_entity_type_key UNIQUE (entity_id, entity_type);


--
-- Name: reputation_scores reputation_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reputation_scores
    ADD CONSTRAINT reputation_scores_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_order_id_key UNIQUE (order_id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: synthetic_conversions synthetic_conversions_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synthetic_conversions
    ADD CONSTRAINT synthetic_conversions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: synthetic_conversions synthetic_conversions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synthetic_conversions
    ADD CONSTRAINT synthetic_conversions_pkey PRIMARY KEY (id);


--
-- Name: disputes unique_dispute_per_order; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT unique_dispute_per_order UNIQUE (order_id);


--
-- Name: user_bank_accounts user_bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bank_accounts
    ADD CONSTRAINT user_bank_accounts_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: users users_wallet_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_wallet_address_key UNIQUE (wallet_address);


--
-- Name: idx_bank_accounts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_accounts_user ON public.user_bank_accounts USING btree (user_id);


--
-- Name: idx_compliance_team_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_team_active ON public.compliance_team USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_corridor_fulfillments_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corridor_fulfillments_deadline ON public.corridor_fulfillments USING btree (send_deadline) WHERE ((provider_status)::text = 'pending'::text);


--
-- Name: idx_corridor_fulfillments_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corridor_fulfillments_order ON public.corridor_fulfillments USING btree (order_id);


--
-- Name: idx_corridor_fulfillments_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corridor_fulfillments_provider ON public.corridor_fulfillments USING btree (provider_merchant_id, provider_status);


--
-- Name: idx_corridor_providers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corridor_providers_active ON public.corridor_providers USING btree (is_active, merchant_id) WHERE (is_active = true);


--
-- Name: idx_direct_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_direct_messages_conversation ON public.direct_messages USING btree (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), created_at DESC);


--
-- Name: idx_direct_messages_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_direct_messages_recipient ON public.direct_messages USING btree (recipient_id, recipient_type, created_at DESC);


--
-- Name: idx_direct_messages_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_direct_messages_sender ON public.direct_messages USING btree (sender_id, sender_type, created_at DESC);


--
-- Name: idx_direct_messages_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_direct_messages_unread ON public.direct_messages USING btree (recipient_id, recipient_type, is_read) WHERE (is_read = false);


--
-- Name: idx_disputes_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disputes_assigned ON public.disputes USING btree (assigned_to, status);


--
-- Name: idx_disputes_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disputes_order ON public.disputes USING btree (order_id);


--
-- Name: idx_disputes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disputes_status ON public.disputes USING btree (status, created_at);


--
-- Name: idx_events_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_order ON public.order_events USING btree (order_id, created_at);


--
-- Name: idx_idempotency_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idempotency_expires ON public.idempotency_keys USING btree (expires_at);


--
-- Name: idx_idempotency_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idempotency_order ON public.idempotency_keys USING btree (order_id) WHERE (order_id IS NOT NULL);


--
-- Name: idx_ledger_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ledger_account ON public.ledger_entries USING btree (account_type, account_id, created_at DESC);


--
-- Name: idx_ledger_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ledger_created ON public.ledger_entries USING btree (created_at DESC);


--
-- Name: idx_ledger_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ledger_idempotency ON public.ledger_entries USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: idx_ledger_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ledger_order ON public.ledger_entries USING btree (related_order_id) WHERE (related_order_id IS NOT NULL);


--
-- Name: idx_ledger_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ledger_type ON public.ledger_entries USING btree (entry_type, created_at DESC);


--
-- Name: idx_merchant_contacts_contact_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_contacts_contact_merchant ON public.merchant_contacts USING btree (contact_merchant_id);


--
-- Name: idx_merchant_contacts_favorites; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_contacts_favorites ON public.merchant_contacts USING btree (merchant_id, is_favorite);


--
-- Name: idx_merchant_contacts_m2m; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_merchant_contacts_m2m ON public.merchant_contacts USING btree (merchant_id, contact_merchant_id) WHERE (contact_merchant_id IS NOT NULL);


--
-- Name: idx_merchant_contacts_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_contacts_merchant ON public.merchant_contacts USING btree (merchant_id);


--
-- Name: idx_merchant_contacts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_contacts_user ON public.merchant_contacts USING btree (user_id);


--
-- Name: idx_merchant_quotes_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_quotes_merchant ON public.merchant_quotes USING btree (merchant_id);


--
-- Name: idx_merchant_quotes_online; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_quotes_online ON public.merchant_quotes USING btree (corridor_id, is_online) WHERE (is_online = true);


--
-- Name: idx_merchant_transactions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_transactions_created_at ON public.merchant_transactions USING btree (created_at DESC);


--
-- Name: idx_merchant_transactions_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_transactions_merchant ON public.merchant_transactions USING btree (merchant_id, created_at DESC);


--
-- Name: idx_merchant_transactions_merchant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_transactions_merchant_id ON public.merchant_transactions USING btree (merchant_id);


--
-- Name: idx_merchant_transactions_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_transactions_order ON public.merchant_transactions USING btree (order_id);


--
-- Name: idx_merchant_transactions_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_transactions_order_id ON public.merchant_transactions USING btree (order_id);


--
-- Name: idx_merchant_transactions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_transactions_type ON public.merchant_transactions USING btree (type);


--
-- Name: idx_merchant_transactions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchant_transactions_user_id ON public.merchant_transactions USING btree (user_id);


--
-- Name: idx_merchants_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchants_email ON public.merchants USING btree (email);


--
-- Name: idx_merchants_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchants_username ON public.merchants USING btree (username);


--
-- Name: idx_merchants_wallet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchants_wallet ON public.merchants USING btree (wallet_address);


--
-- Name: idx_merchants_wallet_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merchants_wallet_address ON public.merchants USING btree (wallet_address);


--
-- Name: idx_messages_human_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_human_latest ON public.chat_messages USING btree (order_id, created_at DESC) INCLUDE (content, sender_type) WHERE ((message_type <> 'system'::public.message_type) AND (sender_type <> 'system'::public.actor_type));


--
-- Name: idx_messages_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_order ON public.chat_messages USING btree (order_id, created_at);


--
-- Name: idx_messages_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_unread ON public.chat_messages USING btree (order_id, sender_type, is_read) WHERE (is_read = false);


--
-- Name: idx_messages_unread_human; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_unread_human ON public.chat_messages USING btree (order_id) WHERE ((is_read = false) AND (sender_type <> ALL (ARRAY['merchant'::public.actor_type, 'system'::public.actor_type])) AND (message_type <> 'system'::public.message_type));


--
-- Name: idx_offers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_active ON public.merchant_offers USING btree (is_active, type, payment_method);


--
-- Name: idx_offers_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_available ON public.merchant_offers USING btree (merchant_id, is_active, available_amount) WHERE (is_active = true);


--
-- Name: idx_offers_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_merchant ON public.merchant_offers USING btree (merchant_id);


--
-- Name: idx_order_events_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_events_order ON public.order_events USING btree (order_id, created_at DESC);


--
-- Name: idx_order_events_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_events_request_id ON public.order_events USING btree (request_id) WHERE (request_id IS NOT NULL);


--
-- Name: idx_order_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_events_type ON public.order_events USING btree (event_type, created_at DESC);


--
-- Name: idx_order_status_history_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_status_history_order ON public.order_status_history USING btree (order_id, created_at);


--
-- Name: idx_orders_acceptor_wallet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_acceptor_wallet ON public.orders USING btree (acceptor_wallet_address) WHERE (acceptor_wallet_address IS NOT NULL);


--
-- Name: idx_orders_buyer_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_buyer_merchant ON public.orders USING btree (buyer_merchant_id, status);


--
-- Name: idx_orders_buyer_merchant_v2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_buyer_merchant_v2 ON public.orders USING btree (buyer_merchant_id, status, created_at DESC);


--
-- Name: idx_orders_cancel_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_cancel_request ON public.orders USING btree (cancel_requested_at) WHERE ((cancel_requested_by IS NOT NULL) AND (status <> ALL (ARRAY['completed'::public.order_status, 'cancelled'::public.order_status, 'expired'::public.order_status])));


--
-- Name: idx_orders_chat_categorization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_chat_categorization ON public.orders USING btree (merchant_id, has_manual_message, status) WHERE (status <> ALL (ARRAY['completed'::public.order_status, 'cancelled'::public.order_status, 'expired'::public.order_status]));


--
-- Name: idx_orders_corridor_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_corridor_status ON public.orders USING btree (corridor_id, status, created_at DESC);


--
-- Name: idx_orders_custom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_custom ON public.orders USING btree (merchant_id, is_custom) WHERE (is_custom = true);


--
-- Name: idx_orders_dispute_auto_resolve; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_dispute_auto_resolve ON public.orders USING btree (dispute_auto_resolve_at) WHERE ((status = 'disputed'::public.order_status) AND (dispute_auto_resolve_at IS NOT NULL));


--
-- Name: idx_orders_escrow_debited; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_escrow_debited ON public.orders USING btree (escrow_debited_entity_type, escrow_debited_entity_id) WHERE (escrow_debited_entity_id IS NOT NULL);


--
-- Name: idx_orders_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_expires_at ON public.orders USING btree (expires_at) WHERE (status = ANY (ARRAY['pending'::public.order_status, 'accepted'::public.order_status, 'escrowed'::public.order_status, 'payment_sent'::public.order_status]));


--
-- Name: idx_orders_extension_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_extension_pending ON public.orders USING btree (extension_requested_at) WHERE ((extension_requested_by IS NOT NULL) AND (status <> ALL (ARRAY['completed'::public.order_status, 'cancelled'::public.order_status, 'expired'::public.order_status])));


--
-- Name: idx_orders_fiat_amount; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_fiat_amount ON public.orders USING btree (merchant_id, fiat_amount DESC) WHERE (status <> ALL (ARRAY['cancelled'::public.order_status, 'expired'::public.order_status]));


--
-- Name: idx_orders_inactivity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_inactivity ON public.orders USING btree (last_activity_at) WHERE ((status <> ALL (ARRAY['completed'::public.order_status, 'cancelled'::public.order_status, 'expired'::public.order_status, 'disputed'::public.order_status, 'pending'::public.order_status])) AND (last_activity_at IS NOT NULL));


--
-- Name: idx_orders_matching; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_matching ON public.orders USING btree (status, type, payment_method, spread_preference, created_at);


--
-- Name: idx_orders_mempool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_mempool ON public.orders USING btree (corridor_id, status, expires_at) WHERE (status = 'pending'::public.order_status);


--
-- Name: idx_orders_merchant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_merchant ON public.orders USING btree (merchant_id, status);


--
-- Name: idx_orders_merchant_v2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_merchant_v2 ON public.orders USING btree (merchant_id, status, created_at DESC);


--
-- Name: idx_orders_next_bump; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_next_bump ON public.orders USING btree (next_bump_at) WHERE ((auto_bump_enabled = true) AND (status = 'pending'::public.order_status));


--
-- Name: idx_orders_payment_via_corridor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_payment_via_corridor ON public.orders USING btree (payment_via) WHERE ((payment_via)::text = 'saed_corridor'::text);


--
-- Name: idx_orders_pending_broadcast; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_pending_broadcast ON public.orders USING btree (status, created_at DESC) WHERE ((accepted_at IS NULL) AND (status = ANY (ARRAY['pending'::public.order_status, 'escrowed'::public.order_status])));


--
-- Name: idx_orders_spread_ranking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_spread_ranking ON public.orders USING btree (spread_preference, created_at) WHERE (status = 'pending'::public.order_status);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status, created_at);


--
-- Name: idx_orders_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_user ON public.orders USING btree (user_id, status);


--
-- Name: idx_orders_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_version ON public.orders USING btree (id, order_version);


--
-- Name: idx_outbox_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbox_order_id ON public.notification_outbox USING btree (order_id);


--
-- Name: idx_outbox_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbox_pending ON public.notification_outbox USING btree (status, created_at) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'failed'::character varying])::text[]));


--
-- Name: idx_outbox_sent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbox_sent ON public.notification_outbox USING btree (sent_at) WHERE ((status)::text = 'sent'::text);


--
-- Name: idx_platform_fee_transactions_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_fee_transactions_created ON public.platform_fee_transactions USING btree (created_at DESC);


--
-- Name: idx_platform_fee_transactions_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_fee_transactions_order ON public.platform_fee_transactions USING btree (order_id);


--
-- Name: idx_platform_fee_tx_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_fee_tx_created ON public.platform_fee_transactions USING btree (created_at DESC);


--
-- Name: idx_platform_fee_tx_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_fee_tx_order ON public.platform_fee_transactions USING btree (order_id);


--
-- Name: idx_ratings_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ratings_order ON public.ratings USING btree (order_id);


--
-- Name: idx_ratings_rated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ratings_rated ON public.ratings USING btree (rated_type, rated_id, created_at DESC);


--
-- Name: idx_ratings_rater; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ratings_rater ON public.ratings USING btree (rater_type, rater_id, created_at DESC);


--
-- Name: idx_reputation_events_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reputation_events_entity ON public.reputation_events USING btree (entity_id, entity_type);


--
-- Name: idx_reputation_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reputation_events_type ON public.reputation_events USING btree (event_type);


--
-- Name: idx_reputation_history_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reputation_history_date ON public.reputation_history USING btree (recorded_at);


--
-- Name: idx_reputation_history_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reputation_history_entity ON public.reputation_history USING btree (entity_id, entity_type);


--
-- Name: idx_reputation_scores_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reputation_scores_entity ON public.reputation_scores USING btree (entity_id, entity_type);


--
-- Name: idx_reputation_scores_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reputation_scores_tier ON public.reputation_scores USING btree (tier);


--
-- Name: idx_reputation_scores_total; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reputation_scores_total ON public.reputation_scores USING btree (total_score DESC);


--
-- Name: idx_reviews_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_order ON public.reviews USING btree (order_id);


--
-- Name: idx_reviews_reviewee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_reviewee ON public.reviews USING btree (reviewee_type, reviewee_id);


--
-- Name: idx_synthetic_conversions_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_synthetic_conversions_account ON public.synthetic_conversions USING btree (account_type, account_id, created_at DESC);


--
-- Name: idx_synthetic_conversions_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_synthetic_conversions_created ON public.synthetic_conversions USING btree (created_at DESC);


--
-- Name: idx_synthetic_conversions_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_synthetic_conversions_idempotency ON public.synthetic_conversions USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_username ON public.users USING btree (username);


--
-- Name: idx_users_wallet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_wallet ON public.users USING btree (wallet_address);


--
-- Name: idx_users_wallet_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_wallet_address ON public.users USING btree (wallet_address);


--
-- Name: messages messages_insert; Type: RULE; Schema: public; Owner: -
--

CREATE RULE messages_insert AS
    ON INSERT TO public.messages DO INSTEAD  INSERT INTO public.chat_messages (order_id, sender_type, sender_id, content, message_type, image_url, is_read, created_at)
  VALUES (new.order_id, new.sender_type, new.sender_id, new.content, new.message_type, new.image_url, COALESCE(new.is_read, false), COALESCE((new.created_at)::timestamp with time zone, now()))
  RETURNING chat_messages.id,
    chat_messages.order_id,
    chat_messages.sender_type,
    chat_messages.sender_id,
    chat_messages.message_type,
    chat_messages.content,
    chat_messages.image_url,
    chat_messages.is_read,
    chat_messages.read_at,
    chat_messages.created_at;


--
-- Name: messages messages_update; Type: RULE; Schema: public; Owner: -
--

CREATE RULE messages_update AS
    ON UPDATE TO public.messages DO INSTEAD  UPDATE public.chat_messages SET is_read = new.is_read, read_at = new.read_at
  WHERE (chat_messages.id = old.id);


--
-- Name: merchants check_username_unique_merchants; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_username_unique_merchants BEFORE INSERT OR UPDATE OF username ON public.merchants FOR EACH ROW EXECUTE FUNCTION public.check_username_unique();


--
-- Name: users check_username_unique_users; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_username_unique_users BEFORE INSERT OR UPDATE OF username ON public.users FOR EACH ROW EXECUTE FUNCTION public.check_username_unique();


--
-- Name: orders set_order_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_order_number BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.generate_order_number();


--
-- Name: chat_messages trg_touch_activity_on_message; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_activity_on_message AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.touch_order_activity_on_message();


--
-- Name: orders trg_touch_order_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_order_activity BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.touch_order_activity();


--
-- Name: orders trigger_auto_log_order_ledger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_auto_log_order_ledger AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.auto_log_order_ledger();


--
-- Name: ratings trigger_update_aggregate_rating; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_aggregate_rating AFTER INSERT ON public.ratings FOR EACH ROW EXECUTE FUNCTION public.update_aggregate_rating();


--
-- Name: reviews trigger_update_merchant_rating; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_merchant_rating AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_merchant_rating();


--
-- Name: reviews trigger_update_user_rating; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_user_rating AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_user_rating();


--
-- Name: compliance_team update_compliance_team_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_compliance_team_updated_at BEFORE UPDATE ON public.compliance_team FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: merchants update_merchants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_merchants_updated_at BEFORE UPDATE ON public.merchants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: merchant_offers update_offers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_offers_updated_at BEFORE UPDATE ON public.merchant_offers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: chat_messages chat_messages_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: corridor_fulfillments corridor_fulfillments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corridor_fulfillments
    ADD CONSTRAINT corridor_fulfillments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: corridor_fulfillments corridor_fulfillments_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corridor_fulfillments
    ADD CONSTRAINT corridor_fulfillments_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.corridor_providers(id);


--
-- Name: corridor_fulfillments corridor_fulfillments_provider_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corridor_fulfillments
    ADD CONSTRAINT corridor_fulfillments_provider_merchant_id_fkey FOREIGN KEY (provider_merchant_id) REFERENCES public.merchants(id);


--
-- Name: corridor_providers corridor_providers_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corridor_providers
    ADD CONSTRAINT corridor_providers_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id);


--
-- Name: disputes disputes_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: ledger_entries ledger_entries_related_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_related_order_id_fkey FOREIGN KEY (related_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: merchant_contacts merchant_contacts_contact_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_contacts
    ADD CONSTRAINT merchant_contacts_contact_merchant_id_fkey FOREIGN KEY (contact_merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;


--
-- Name: merchant_contacts merchant_contacts_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_contacts
    ADD CONSTRAINT merchant_contacts_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;


--
-- Name: merchant_contacts merchant_contacts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_contacts
    ADD CONSTRAINT merchant_contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: merchant_offers merchant_offers_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_offers
    ADD CONSTRAINT merchant_offers_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;


--
-- Name: merchant_quotes merchant_quotes_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_quotes
    ADD CONSTRAINT merchant_quotes_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;


--
-- Name: merchant_transactions merchant_transactions_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_transactions
    ADD CONSTRAINT merchant_transactions_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;


--
-- Name: merchant_transactions merchant_transactions_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_transactions
    ADD CONSTRAINT merchant_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: merchant_transactions merchant_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_transactions
    ADD CONSTRAINT merchant_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notification_outbox notification_outbox_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_events order_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_status_history order_status_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: orders orders_buyer_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_buyer_merchant_id_fkey FOREIGN KEY (buyer_merchant_id) REFERENCES public.merchants(id);


--
-- Name: orders orders_corridor_fulfillment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_corridor_fulfillment_id_fkey FOREIGN KEY (corridor_fulfillment_id) REFERENCES public.corridor_fulfillments(id);


--
-- Name: orders orders_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.merchants(id);


--
-- Name: orders orders_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.merchant_offers(id);


--
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: orders orders_winner_merchant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_winner_merchant_id_fkey FOREIGN KEY (winner_merchant_id) REFERENCES public.merchants(id);


--
-- Name: platform_fee_transactions platform_fee_transactions_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_fee_transactions
    ADD CONSTRAINT platform_fee_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: ratings ratings_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: user_bank_accounts user_bank_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bank_accounts
    ADD CONSTRAINT user_bank_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

