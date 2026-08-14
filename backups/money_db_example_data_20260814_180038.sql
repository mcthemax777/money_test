--
-- PostgreSQL database dump
--

\restrict AKknmdkRrTzNodmrlcOgxQV2uvQApVXLH3BdU85l3Eykv5AHihacXqnObb7Jcut

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

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
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO postgres;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: postgres
--

COMMENT ON SCHEMA public IS '';


--
-- Name: CardType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."CardType" AS ENUM (
    'debit',
    'credit'
);


ALTER TYPE public."CardType" OWNER TO postgres;

--
-- Name: InvitationStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."InvitationStatus" AS ENUM (
    'pending',
    'accepted',
    'declined',
    'expired'
);


ALTER TYPE public."InvitationStatus" OWNER TO postgres;

--
-- Name: PaymentStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."PaymentStatus" AS ENUM (
    'pending',
    'completed'
);


ALTER TYPE public."PaymentStatus" OWNER TO postgres;

--
-- Name: ProjectRole; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ProjectRole" AS ENUM (
    'owner',
    'editor',
    'viewer'
);


ALTER TYPE public."ProjectRole" OWNER TO postgres;

--
-- Name: TransactionType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."TransactionType" AS ENUM (
    'income',
    'expense',
    'transfer'
);


ALTER TYPE public."TransactionType" OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Account; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Account" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "userId" text NOT NULL,
    "ownerId" text NOT NULL,
    name text NOT NULL,
    "accountNumber" text,
    balance double precision DEFAULT 0 NOT NULL,
    "bankName" text NOT NULL,
    currency text DEFAULT 'KRW'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Account" OWNER TO postgres;

--
-- Name: Card; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Card" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "userId" text NOT NULL,
    "accountId" text NOT NULL,
    name text NOT NULL,
    "cardNumber" text,
    "cardType" public."CardType" DEFAULT 'debit'::public."CardType" NOT NULL,
    issuer text NOT NULL,
    "expiryDate" timestamp(3) without time zone,
    "creditLimit" double precision,
    "currentBalance" double precision DEFAULT 0,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Card" OWNER TO postgres;

--
-- Name: CardPayment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."CardPayment" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "userId" text NOT NULL,
    "cardId" text NOT NULL,
    "accountId" text NOT NULL,
    "totalAmount" double precision NOT NULL,
    "paidAmount" double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    "paymentDate" timestamp(3) without time zone NOT NULL,
    "transactionId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."CardPayment" OWNER TO postgres;

--
-- Name: CardPaymentUsage; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."CardPaymentUsage" (
    id text NOT NULL,
    "cardPaymentId" text NOT NULL,
    "cardUsageId" text NOT NULL,
    amount double precision NOT NULL,
    "createdAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."CardPaymentUsage" OWNER TO postgres;

--
-- Name: CardUsage; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."CardUsage" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "userId" text NOT NULL,
    "cardId" text NOT NULL,
    amount double precision NOT NULL,
    merchant text NOT NULL,
    date timestamp(3) without time zone NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    "isPaymentDue" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."CardUsage" OWNER TO postgres;

--
-- Name: Category; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Category" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "userId" text NOT NULL,
    name text NOT NULL,
    "parentId" text,
    level integer DEFAULT 1 NOT NULL,
    type text NOT NULL,
    icon text,
    "defaultIsFixed" boolean DEFAULT false NOT NULL,
    "isDefault" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Category" OWNER TO postgres;

--
-- Name: Person; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Person" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "userId" text NOT NULL,
    name text NOT NULL,
    relationship text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Person" OWNER TO postgres;

--
-- Name: Project; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Project" (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Project" OWNER TO postgres;

--
-- Name: ProjectInvitation; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ProjectInvitation" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    email text NOT NULL,
    "invitationCode" text NOT NULL,
    role public."ProjectRole" DEFAULT 'editor'::public."ProjectRole" NOT NULL,
    status public."InvitationStatus" DEFAULT 'pending'::public."InvitationStatus" NOT NULL,
    "invitedByUserId" text NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "acceptedAt" timestamp(3) without time zone,
    "acceptedByUserId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."ProjectInvitation" OWNER TO postgres;

--
-- Name: ProjectMember; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ProjectMember" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "userId" text NOT NULL,
    role public."ProjectRole" DEFAULT 'editor'::public."ProjectRole" NOT NULL,
    "joinedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ProjectMember" OWNER TO postgres;

--
-- Name: Transaction; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Transaction" (
    id text NOT NULL,
    "projectId" text NOT NULL,
    "userId" text NOT NULL,
    "accountId" text NOT NULL,
    "personId" text NOT NULL,
    "cardId" text,
    type public."TransactionType" NOT NULL,
    amount double precision NOT NULL,
    description text NOT NULL,
    date timestamp(3) without time zone NOT NULL,
    "mainCategoryId" text,
    "subCategoryId" text,
    tags text[] DEFAULT ARRAY[]::text[],
    "isRecurring" boolean DEFAULT false NOT NULL,
    "recurringPattern" text,
    "isFixed" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Transaction" OWNER TO postgres;

--
-- Name: User; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    name text NOT NULL,
    avatar text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."User" OWNER TO postgres;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO postgres;

--
-- Data for Name: Account; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Account" (id, "projectId", "userId", "ownerId", name, "accountNumber", balance, "bankName", currency, "isActive", "createdAt", "updatedAt") FROM stdin;
cmsspoacr00242xo6onf8miud	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoabk00202xo6pgdroqbc	신한 급여통장	1100123456789	5000000	신한	KRW	t	2026-08-14 08:54:52.011	2026-08-14 08:54:52.011
cmsspoadg00262xo6trzucjnk	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoabk00202xo6pgdroqbc	KB 저축통장	2100456789012	2000000	KB국민	KRW	t	2026-08-14 08:54:52.036	2026-08-14 08:54:52.036
cmsspoaeq002a2xo6nl64ji0y	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoac500222xo6so1svssn	하나 저축통장	4100234567890	1377000	하나	KRW	t	2026-08-14 08:54:52.082	2026-08-14 08:58:27.922
cmsspoae200282xo6wmtya5rr	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoac500222xo6so1svssn	우리 급여통장	3100789012345	7890000	우리	KRW	t	2026-08-14 08:54:52.058	2026-08-14 08:58:28.5
\.


--
-- Data for Name: Card; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Card" (id, "projectId", "userId", "accountId", name, "cardNumber", "cardType", issuer, "expiryDate", "creditLimit", "currentBalance", "isActive", "createdAt", "updatedAt") FROM stdin;
cmssprnl7003w2xo696vs8nx3	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoaeq002a2xo6nl64ji0y	테스트카드	4111111111111111	debit	신한	\N	\N	0	t	2026-08-14 08:57:29.132	2026-08-14 08:57:29.132
cmssprrus003y2xo6zvd2unzd	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoaeq002a2xo6nl64ji0y	신한 신용카드	4111111111111003	debit	신한	\N	\N	0	t	2026-08-14 08:57:34.661	2026-08-14 08:57:34.661
cmssprrvd00402xo6pstotjul	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoaeq002a2xo6nl64ji0y	체크카드	5555555555555004	debit	신한	\N	\N	0	t	2026-08-14 08:57:34.681	2026-08-14 08:57:34.681
cmssprrvv00422xo6hw7yq39v	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	신한 신용카드	4111111111111005	debit	신한	\N	\N	0	t	2026-08-14 08:57:34.699	2026-08-14 08:57:34.699
cmssprrwb00442xo6tcsjvv5m	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	체크카드	5555555555555006	debit	신한	\N	\N	0	t	2026-08-14 08:57:34.715	2026-08-14 08:57:34.715
cmssprrws00462xo6wczg0fod	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoadg00262xo6trzucjnk	신한 신용카드	4111111111111007	debit	신한	\N	\N	0	t	2026-08-14 08:57:34.733	2026-08-14 08:57:34.733
cmssprrx600482xo6clul29zo	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoadg00262xo6trzucjnk	체크카드	5555555555555008	debit	신한	\N	\N	0	t	2026-08-14 08:57:34.746	2026-08-14 08:57:34.746
\.


--
-- Data for Name: CardPayment; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."CardPayment" (id, "projectId", "userId", "cardId", "accountId", "totalAmount", "paidAmount", status, "paymentDate", "transactionId", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: CardPaymentUsage; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."CardPaymentUsage" (id, "cardPaymentId", "cardUsageId", amount, "createdAt") FROM stdin;
\.


--
-- Data for Name: CardUsage; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."CardUsage" (id, "projectId", "userId", "cardId", amount, merchant, date, status, "isPaymentDue", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Category; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Category" (id, "projectId", "userId", name, "parentId", level, type, icon, "defaultIsFixed", "isDefault", "isActive", "createdAt", "updatedAt") FROM stdin;
cmsspoaa300182xo6icnu7xtl	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	급여	\N	1	income	\N	f	f	t	2026-08-14 08:54:51.916	2026-08-14 08:54:51.916
cmsspoaa5001a2xo627n1t4hp	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	상여금	\N	1	income	\N	f	f	t	2026-08-14 08:54:51.917	2026-08-14 08:54:51.917
cmsspoaa6001c2xo6zaq9l1hl	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	이자/배당금	\N	1	income	\N	f	f	t	2026-08-14 08:54:51.918	2026-08-14 08:54:51.918
cmsspoaa6001e2xo6sdmpvs2i	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	기타수입	\N	1	income	\N	f	f	t	2026-08-14 08:54:51.919	2026-08-14 08:54:51.919
cmsspoaa7001g2xo6r1riyope	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	식료품	\N	1	expense	\N	f	f	t	2026-08-14 08:54:51.92	2026-08-14 08:54:51.92
cmsspoaa8001i2xo6s1ifufs0	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	외식	\N	1	expense	\N	f	f	t	2026-08-14 08:54:51.921	2026-08-14 08:54:51.921
cmsspoaa9001k2xo60pdr7uoh	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	교통	\N	1	expense	\N	f	f	t	2026-08-14 08:54:51.921	2026-08-14 08:54:51.921
cmsspoaaa001m2xo6kbbei1vm	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	통신	\N	1	expense	\N	f	f	t	2026-08-14 08:54:51.922	2026-08-14 08:54:51.922
cmsspoaaa001o2xo6eqmih49n	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	공과금	\N	1	expense	\N	f	f	t	2026-08-14 08:54:51.923	2026-08-14 08:54:51.923
cmsspoaab001q2xo62xgvtcp4	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	교육	\N	1	expense	\N	f	f	t	2026-08-14 08:54:51.923	2026-08-14 08:54:51.923
cmsspoaac001s2xo6asw93umc	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	의료	\N	1	expense	\N	f	f	t	2026-08-14 08:54:51.924	2026-08-14 08:54:51.924
cmsspoaac001u2xo60n9uhwas	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	쇼핑	\N	1	expense	\N	f	f	t	2026-08-14 08:54:51.925	2026-08-14 08:54:51.925
cmsspoaad001w2xo6u2yaj1ek	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	엔터테인먼트	\N	1	expense	\N	f	f	t	2026-08-14 08:54:51.925	2026-08-14 08:54:51.925
cmsspoaad001y2xo63zjwv37o	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	저축	\N	1	expense	\N	f	f	t	2026-08-14 08:54:51.926	2026-08-14 08:54:51.926
cmssporix00342xo6t6urfasc	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	식비	\N	1	expense	\N	f	f	t	2026-08-14 08:55:14.266	2026-08-14 08:55:14.266
cmssporlw00362xo6ze8pmxyk	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	문화	\N	1	expense	\N	f	f	t	2026-08-14 08:55:14.372	2026-08-14 08:55:14.372
cmsspornw00382xo60mlcjxxv	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	주거	\N	1	expense	\N	f	f	t	2026-08-14 08:55:14.444	2026-08-14 08:55:14.444
cmssporov003a2xo6mylvkqii	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	생활	\N	1	expense	\N	f	f	t	2026-08-14 08:55:14.479	2026-08-14 08:55:14.479
cmssporqh003c2xo6s38qljm7	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	보너스	\N	1	income	\N	f	f	t	2026-08-14 08:55:14.537	2026-08-14 08:55:14.537
cmssporr2003e2xo655pr0ipq	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	용돈	\N	1	income	\N	f	f	t	2026-08-14 08:55:14.558	2026-08-14 08:55:14.558
cmsspry4p004a2xo6gakai6tm	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	아침밥	cmssporix00342xo6t6urfasc	2	expense	\N	f	f	t	2026-08-14 08:57:42.793	2026-08-14 08:57:42.793
cmsspry58004c2xo6mdtrwdve	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	점심	cmssporix00342xo6t6urfasc	2	expense	\N	f	f	t	2026-08-14 08:57:42.813	2026-08-14 08:57:42.813
cmsspry5p004e2xo6segt52ro	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	저녁	cmssporix00342xo6t6urfasc	2	expense	\N	f	f	t	2026-08-14 08:57:42.83	2026-08-14 08:57:42.83
cmsspry67004g2xo6wivp6650	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	간식	cmssporix00342xo6t6urfasc	2	expense	\N	f	f	t	2026-08-14 08:57:42.847	2026-08-14 08:57:42.847
cmsspry6n004i2xo6e7uth8dp	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	카페	cmssporix00342xo6t6urfasc	2	expense	\N	f	f	t	2026-08-14 08:57:42.864	2026-08-14 08:57:42.864
cmsspry78004k2xo6sbgh1k3z	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	지하철	cmsspoaa9001k2xo60pdr7uoh	2	expense	\N	f	f	t	2026-08-14 08:57:42.885	2026-08-14 08:57:42.885
cmsspry7r004m2xo6kglbl10a	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	택시	cmsspoaa9001k2xo60pdr7uoh	2	expense	\N	f	f	t	2026-08-14 08:57:42.904	2026-08-14 08:57:42.904
cmsspry89004o2xo6hi7cfsdo	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	버스	cmsspoaa9001k2xo60pdr7uoh	2	expense	\N	f	f	t	2026-08-14 08:57:42.921	2026-08-14 08:57:42.921
cmsspry8q004q2xo6nlqq05bu	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	주차	cmsspoaa9001k2xo60pdr7uoh	2	expense	\N	f	f	t	2026-08-14 08:57:42.938	2026-08-14 08:57:42.938
cmsspry9a004s2xo626em1mkx	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	의류	cmsspoaac001u2xo60n9uhwas	2	expense	\N	f	f	t	2026-08-14 08:57:42.958	2026-08-14 08:57:42.958
cmsspry9q004u2xo65f9hkfw9	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	신발	cmsspoaac001u2xo60n9uhwas	2	expense	\N	f	f	t	2026-08-14 08:57:42.975	2026-08-14 08:57:42.975
cmssprya7004w2xo60b06zt2p	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	가방	cmsspoaac001u2xo60n9uhwas	2	expense	\N	f	f	t	2026-08-14 08:57:42.991	2026-08-14 08:57:42.991
cmsspryaq004y2xo61yws0sr3	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	액세서리	cmsspoaac001u2xo60n9uhwas	2	expense	\N	f	f	t	2026-08-14 08:57:43.01	2026-08-14 08:57:43.01
cmssprybb00502xo6ifjpgtp2	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	영화	cmssporlw00362xo6ze8pmxyk	2	expense	\N	f	f	t	2026-08-14 08:57:43.031	2026-08-14 08:57:43.031
cmssprybs00522xo6cw6pxkjn	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	공연	cmssporlw00362xo6ze8pmxyk	2	expense	\N	f	f	t	2026-08-14 08:57:43.049	2026-08-14 08:57:43.049
cmsspryc800542xo6xgo01lx3	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	도서	cmssporlw00362xo6ze8pmxyk	2	expense	\N	f	f	t	2026-08-14 08:57:43.065	2026-08-14 08:57:43.065
cmssprycr00562xo6ewv1p0j9	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	게임	cmssporlw00362xo6ze8pmxyk	2	expense	\N	f	f	t	2026-08-14 08:57:43.083	2026-08-14 08:57:43.083
cmsspryde00582xo6xdliag5k	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	약국	cmsspoaac001s2xo6asw93umc	2	expense	\N	f	f	t	2026-08-14 08:57:43.106	2026-08-14 08:57:43.106
cmssprydw005a2xo6za5ydnf9	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	병원	cmsspoaac001s2xo6asw93umc	2	expense	\N	f	f	t	2026-08-14 08:57:43.124	2026-08-14 08:57:43.124
cmsspryec005c2xo6db3twlc9	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	치과	cmsspoaac001s2xo6asw93umc	2	expense	\N	f	f	t	2026-08-14 08:57:43.14	2026-08-14 08:57:43.14
\.


--
-- Data for Name: Person; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Person" (id, "projectId", "userId", name, relationship, "isActive", "createdAt", "updatedAt") FROM stdin;
cmsspoabk00202xo6pgdroqbc	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	김철수	\N	t	2026-08-14 08:54:51.969	2026-08-14 08:54:51.969
cmsspoac500222xo6so1svssn	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	이영희	\N	t	2026-08-14 08:54:51.989	2026-08-14 08:54:51.989
\.


--
-- Data for Name: Project; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Project" (id, name, description, "createdAt", "updatedAt") FROM stdin;
cmsspoa9z00142xo6vl94r63o	나의 프로젝트	첫 번째 프로젝트	2026-08-14 08:54:51.912	2026-08-14 08:54:51.912
\.


--
-- Data for Name: ProjectInvitation; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ProjectInvitation" (id, "projectId", email, "invitationCode", role, status, "invitedByUserId", "expiresAt", "acceptedAt", "acceptedByUserId", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: ProjectMember; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ProjectMember" (id, "projectId", "userId", role, "joinedAt") FROM stdin;
cmsspoaa100162xo6qf06w3r3	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	owner	2026-08-14 08:54:51.914
\.


--
-- Data for Name: Transaction; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Transaction" (id, "projectId", "userId", "accountId", "personId", "cardId", type, amount, description, date, "mainCategoryId", "subCategoryId", tags, "isRecurring", "recurringPattern", "isFixed", "createdAt", "updatedAt") FROM stdin;
cmsspswuv005k2xo6mu6xy06y	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoaeq002a2xo6nl64ji0y	cmsspoabk00202xo6pgdroqbc	cmssprrx600482xo6clul29zo	expense	15000	옷	2026-08-10 00:00:00	cmsspoaac001u2xo60n9uhwas	cmsspry9a004s2xo626em1mkx	{}	f	\N	f	2026-08-14 08:58:27.799	2026-08-14 08:58:27.799
cmsspswvr005m2xo6p48unryd	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoaeq002a2xo6nl64ji0y	cmsspoabk00202xo6pgdroqbc	cmssprrx600482xo6clul29zo	expense	8000	신발	2026-08-10 00:00:00	cmsspoaac001u2xo60n9uhwas	cmsspry9q004u2xo65f9hkfw9	{}	f	\N	f	2026-08-14 08:58:27.832	2026-08-14 08:58:27.832
cmsspswwk005o2xo6cqpscz9b	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoaeq002a2xo6nl64ji0y	cmsspoabk00202xo6pgdroqbc	cmssprrx600482xo6clul29zo	expense	45000	영화	2026-08-10 00:00:00	cmssporlw00362xo6ze8pmxyk	cmssprybb00502xo6ifjpgtp2	{}	f	\N	f	2026-08-14 08:58:27.86	2026-08-14 08:58:27.86
cmsspswxd005q2xo6kxz9lja7	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoaeq002a2xo6nl64ji0y	cmsspoabk00202xo6pgdroqbc	cmssprrx600482xo6clul29zo	expense	30000	공연	2026-08-10 00:00:00	cmssporlw00362xo6ze8pmxyk	cmssprybs00522xo6cw6pxkjn	{}	f	\N	f	2026-08-14 08:58:27.889	2026-08-14 08:58:27.889
cmsspswy4005s2xo6sx8jgozc	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoaeq002a2xo6nl64ji0y	cmsspoabk00202xo6pgdroqbc	cmssprrx600482xo6clul29zo	expense	25000	책	2026-08-10 00:00:00	cmssporlw00362xo6ze8pmxyk	cmsspryc800542xo6xgo01lx3	{}	f	\N	f	2026-08-14 08:58:27.916	2026-08-14 08:58:27.916
cmsspswz0005u2xo66zkt5eog	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoabk00202xo6pgdroqbc	cmssprrx600482xo6clul29zo	expense	35000	병원	2026-08-10 00:00:00	cmsspoaac001s2xo6asw93umc	cmssprydw005a2xo6za5ydnf9	{}	f	\N	f	2026-08-14 08:58:27.948	2026-08-14 08:58:27.948
cmsspswzt005w2xo66cvs9w91	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoabk00202xo6pgdroqbc	cmssprrx600482xo6clul29zo	expense	15000	약국	2026-08-10 00:00:00	cmsspoaac001s2xo6asw93umc	cmsspryde00582xo6xdliag5k	{}	f	\N	f	2026-08-14 08:58:27.977	2026-08-14 08:58:27.977
cmsspsx1y00622xo6ydx9w7ft	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoac500222xo6so1svssn	cmssprrws00462xo6wczg0fod	expense	10000	아침	2026-08-10 00:00:00	cmssporix00342xo6t6urfasc	cmsspry4p004a2xo6gakai6tm	{}	f	\N	f	2026-08-14 08:58:28.054	2026-08-14 08:58:28.054
cmsspsx2s00642xo6mhx0khss	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoac500222xo6so1svssn	cmssprrws00462xo6wczg0fod	expense	12000	저녁	2026-08-10 00:00:00	cmssporix00342xo6t6urfasc	cmsspry5p004e2xo6segt52ro	{}	f	\N	f	2026-08-14 08:58:28.084	2026-08-14 08:58:28.084
cmsspsx3l00662xo6cb7t3hz8	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoac500222xo6so1svssn	cmssprrws00462xo6wczg0fod	expense	6000	간식	2026-08-10 00:00:00	cmssporix00342xo6t6urfasc	cmsspry67004g2xo6wivp6650	{}	f	\N	f	2026-08-14 08:58:28.114	2026-08-14 08:58:28.114
cmsspsx4d00682xo6s1qy2qrw	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoac500222xo6so1svssn	cmssprrws00462xo6wczg0fod	expense	8000	택시	2026-08-10 00:00:00	cmsspoaa9001k2xo60pdr7uoh	cmsspry7r004m2xo6kglbl10a	{}	f	\N	f	2026-08-14 08:58:28.141	2026-08-14 08:58:28.141
cmsspsx57006a2xo6m7cfbhc0	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoac500222xo6so1svssn	cmssprrws00462xo6wczg0fod	expense	4000	버스	2026-08-10 00:00:00	cmsspoaa9001k2xo60pdr7uoh	cmsspry89004o2xo6hi7cfsdo	{}	f	\N	f	2026-08-14 08:58:28.171	2026-08-14 08:58:28.171
cmsspsx5y006c2xo6l8qkr7es	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoac500222xo6so1svssn	cmssprrwb00442xo6tcsjvv5m	expense	20000	신발	2026-08-10 00:00:00	cmsspoaac001u2xo60n9uhwas	cmsspry9q004u2xo65f9hkfw9	{}	f	\N	f	2026-08-14 08:58:28.199	2026-08-14 08:58:28.199
cmsspsx6s006e2xo6tryreq2n	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoac500222xo6so1svssn	cmssprrwb00442xo6tcsjvv5m	expense	18000	가방	2026-08-10 00:00:00	cmsspoaac001u2xo60n9uhwas	cmssprya7004w2xo60b06zt2p	{}	f	\N	f	2026-08-14 08:58:28.229	2026-08-14 08:58:28.229
cmsspsx7l006g2xo6onmy5d2n	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoac500222xo6so1svssn	cmssprrwb00442xo6tcsjvv5m	expense	12000	게임	2026-08-10 00:00:00	cmssporlw00362xo6ze8pmxyk	cmssprycr00562xo6ewv1p0j9	{}	f	\N	f	2026-08-14 08:58:28.257	2026-08-14 08:58:28.257
cmsspsx8h006i2xo6xw33v0x4	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoac500222xo6so1svssn	cmssprrwb00442xo6tcsjvv5m	expense	15000	치과	2026-08-10 00:00:00	cmsspoaac001s2xo6asw93umc	cmsspryec005c2xo6db3twlc9	{}	f	\N	f	2026-08-14 08:58:28.289	2026-08-14 08:58:28.289
cmsspsx97006k2xo6eocgbdx7	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoac500222xo6so1svssn	cmssprrws00462xo6wczg0fod	income	3500000	월급	2026-08-10 00:00:00	cmsspoaa300182xo6icnu7xtl	\N	{}	f	\N	f	2026-08-14 08:58:28.315	2026-08-14 08:58:28.315
cmsspsx9y006m2xo6pp48et9q	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoac500222xo6so1svssn	cmssprrws00462xo6wczg0fod	income	300000	용돈	2026-08-10 00:00:00	cmssporr2003e2xo655pr0ipq	\N	{}	f	\N	f	2026-08-14 08:58:28.342	2026-08-14 08:58:28.342
cmsspsxcq006u2xo6qqq76pn2	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoac500222xo6so1svssn	cmssprrws00462xo6wczg0fod	expense	180000	월세	2026-08-10 00:00:00	cmsspornw00382xo60mlcjxxv	\N	{}	f	\N	f	2026-08-14 08:58:28.442	2026-08-14 08:58:28.442
cmsspsxdf006w2xo6fy8pfyei	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoac500222xo6so1svssn	cmssprrws00462xo6wczg0fod	expense	50000	관리비	2026-08-10 00:00:00	cmsspornw00382xo60mlcjxxv	\N	{}	f	\N	f	2026-08-14 08:58:28.467	2026-08-14 08:58:28.467
cmsspsxe7006y2xo6cd8q9m5o	cmsspoa9z00142xo6vl94r63o	cmsspoa9u00132xo6f4pks6ak	cmsspoae200282xo6wmtya5rr	cmsspoac500222xo6so1svssn	cmssprrws00462xo6wczg0fod	expense	25000	인터넷	2026-08-10 00:00:00	cmsspornw00382xo60mlcjxxv	\N	{}	f	\N	f	2026-08-14 08:58:28.496	2026-08-14 08:58:28.496
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."User" (id, email, password, name, avatar, "createdAt", "updatedAt") FROM stdin;
cmsspoa9u00132xo6f4pks6ak	test@example.com	$2a$10$f4Rc7p6IALzrVdKe.6IQqOzYDiTzhijHSm2SkyExIM3/V8cdtxShq	테스트	\N	2026-08-14 08:54:51.906	2026-08-14 08:54:51.906
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
04717519-1202-42ed-9c96-1ed78ce2bc8e	f4ee29a96b492aa358459c224c73182721524a5e470c17a22e0cf88ae5865609	2026-08-14 08:54:38.390081+00	20260814000000_init	\N	\N	2026-08-14 08:54:38.314208+00	1
\.


--
-- Name: Account Account_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Account"
    ADD CONSTRAINT "Account_pkey" PRIMARY KEY (id);


--
-- Name: CardPaymentUsage CardPaymentUsage_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CardPaymentUsage"
    ADD CONSTRAINT "CardPaymentUsage_pkey" PRIMARY KEY (id);


--
-- Name: CardPayment CardPayment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CardPayment"
    ADD CONSTRAINT "CardPayment_pkey" PRIMARY KEY (id);


--
-- Name: CardUsage CardUsage_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CardUsage"
    ADD CONSTRAINT "CardUsage_pkey" PRIMARY KEY (id);


--
-- Name: Card Card_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Card"
    ADD CONSTRAINT "Card_pkey" PRIMARY KEY (id);


--
-- Name: Category Category_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Category"
    ADD CONSTRAINT "Category_pkey" PRIMARY KEY (id);


--
-- Name: Person Person_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Person"
    ADD CONSTRAINT "Person_pkey" PRIMARY KEY (id);


--
-- Name: ProjectInvitation ProjectInvitation_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectInvitation"
    ADD CONSTRAINT "ProjectInvitation_pkey" PRIMARY KEY (id);


--
-- Name: ProjectMember ProjectMember_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectMember"
    ADD CONSTRAINT "ProjectMember_pkey" PRIMARY KEY (id);


--
-- Name: Project Project_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Project"
    ADD CONSTRAINT "Project_pkey" PRIMARY KEY (id);


--
-- Name: Transaction Transaction_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Transaction"
    ADD CONSTRAINT "Transaction_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: Account_bankName_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Account_bankName_idx" ON public."Account" USING btree ("bankName");


--
-- Name: Account_ownerId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Account_ownerId_idx" ON public."Account" USING btree ("ownerId");


--
-- Name: Account_projectId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Account_projectId_idx" ON public."Account" USING btree ("projectId");


--
-- Name: Account_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Account_userId_idx" ON public."Account" USING btree ("userId");


--
-- Name: CardPaymentUsage_cardPaymentId_cardUsageId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "CardPaymentUsage_cardPaymentId_cardUsageId_key" ON public."CardPaymentUsage" USING btree ("cardPaymentId", "cardUsageId");


--
-- Name: CardPaymentUsage_cardPaymentId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "CardPaymentUsage_cardPaymentId_idx" ON public."CardPaymentUsage" USING btree ("cardPaymentId");


--
-- Name: CardPaymentUsage_cardUsageId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "CardPaymentUsage_cardUsageId_idx" ON public."CardPaymentUsage" USING btree ("cardUsageId");


--
-- Name: CardPayment_cardId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "CardPayment_cardId_idx" ON public."CardPayment" USING btree ("cardId");


--
-- Name: CardPayment_projectId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "CardPayment_projectId_idx" ON public."CardPayment" USING btree ("projectId");


--
-- Name: CardPayment_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "CardPayment_status_idx" ON public."CardPayment" USING btree (status);


--
-- Name: CardPayment_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "CardPayment_userId_idx" ON public."CardPayment" USING btree ("userId");


--
-- Name: CardUsage_cardId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "CardUsage_cardId_idx" ON public."CardUsage" USING btree ("cardId");


--
-- Name: CardUsage_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "CardUsage_date_idx" ON public."CardUsage" USING btree (date);


--
-- Name: CardUsage_projectId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "CardUsage_projectId_idx" ON public."CardUsage" USING btree ("projectId");


--
-- Name: CardUsage_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "CardUsage_userId_idx" ON public."CardUsage" USING btree ("userId");


--
-- Name: Card_accountId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Card_accountId_idx" ON public."Card" USING btree ("accountId");


--
-- Name: Card_cardType_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Card_cardType_idx" ON public."Card" USING btree ("cardType");


--
-- Name: Card_projectId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Card_projectId_idx" ON public."Card" USING btree ("projectId");


--
-- Name: Card_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Card_userId_idx" ON public."Card" USING btree ("userId");


--
-- Name: Category_isDefault_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Category_isDefault_idx" ON public."Category" USING btree ("isDefault");


--
-- Name: Category_parentId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Category_parentId_idx" ON public."Category" USING btree ("parentId");


--
-- Name: Category_projectId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Category_projectId_idx" ON public."Category" USING btree ("projectId");


--
-- Name: Category_projectId_userId_name_parentId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Category_projectId_userId_name_parentId_key" ON public."Category" USING btree ("projectId", "userId", name, "parentId");


--
-- Name: Category_type_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Category_type_idx" ON public."Category" USING btree (type);


--
-- Name: Category_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Category_userId_idx" ON public."Category" USING btree ("userId");


--
-- Name: Person_projectId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Person_projectId_idx" ON public."Person" USING btree ("projectId");


--
-- Name: Person_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Person_userId_idx" ON public."Person" USING btree ("userId");


--
-- Name: ProjectInvitation_email_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProjectInvitation_email_idx" ON public."ProjectInvitation" USING btree (email);


--
-- Name: ProjectInvitation_invitationCode_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "ProjectInvitation_invitationCode_key" ON public."ProjectInvitation" USING btree ("invitationCode");


--
-- Name: ProjectInvitation_projectId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProjectInvitation_projectId_idx" ON public."ProjectInvitation" USING btree ("projectId");


--
-- Name: ProjectInvitation_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProjectInvitation_status_idx" ON public."ProjectInvitation" USING btree (status);


--
-- Name: ProjectMember_projectId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProjectMember_projectId_idx" ON public."ProjectMember" USING btree ("projectId");


--
-- Name: ProjectMember_projectId_userId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON public."ProjectMember" USING btree ("projectId", "userId");


--
-- Name: ProjectMember_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProjectMember_userId_idx" ON public."ProjectMember" USING btree ("userId");


--
-- Name: Transaction_accountId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Transaction_accountId_idx" ON public."Transaction" USING btree ("accountId");


--
-- Name: Transaction_cardId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Transaction_cardId_idx" ON public."Transaction" USING btree ("cardId");


--
-- Name: Transaction_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Transaction_date_idx" ON public."Transaction" USING btree (date);


--
-- Name: Transaction_isFixed_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Transaction_isFixed_idx" ON public."Transaction" USING btree ("isFixed");


--
-- Name: Transaction_mainCategoryId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Transaction_mainCategoryId_idx" ON public."Transaction" USING btree ("mainCategoryId");


--
-- Name: Transaction_personId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Transaction_personId_idx" ON public."Transaction" USING btree ("personId");


--
-- Name: Transaction_projectId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Transaction_projectId_idx" ON public."Transaction" USING btree ("projectId");


--
-- Name: Transaction_subCategoryId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Transaction_subCategoryId_idx" ON public."Transaction" USING btree ("subCategoryId");


--
-- Name: Transaction_type_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Transaction_type_idx" ON public."Transaction" USING btree (type);


--
-- Name: Transaction_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Transaction_userId_idx" ON public."Transaction" USING btree ("userId");


--
-- Name: User_email_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "User_email_idx" ON public."User" USING btree (email);


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: Account Account_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Account"
    ADD CONSTRAINT "Account_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."Person"(id);


--
-- Name: Account Account_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Account"
    ADD CONSTRAINT "Account_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Account Account_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Account"
    ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CardPaymentUsage CardPaymentUsage_cardPaymentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CardPaymentUsage"
    ADD CONSTRAINT "CardPaymentUsage_cardPaymentId_fkey" FOREIGN KEY ("cardPaymentId") REFERENCES public."CardPayment"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CardPaymentUsage CardPaymentUsage_cardUsageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CardPaymentUsage"
    ADD CONSTRAINT "CardPaymentUsage_cardUsageId_fkey" FOREIGN KEY ("cardUsageId") REFERENCES public."CardUsage"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CardPayment CardPayment_accountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CardPayment"
    ADD CONSTRAINT "CardPayment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public."Account"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CardPayment CardPayment_cardId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CardPayment"
    ADD CONSTRAINT "CardPayment_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES public."Card"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CardPayment CardPayment_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CardPayment"
    ADD CONSTRAINT "CardPayment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CardPayment CardPayment_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CardPayment"
    ADD CONSTRAINT "CardPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CardUsage CardUsage_cardId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CardUsage"
    ADD CONSTRAINT "CardUsage_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES public."Card"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CardUsage CardUsage_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CardUsage"
    ADD CONSTRAINT "CardUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CardUsage CardUsage_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CardUsage"
    ADD CONSTRAINT "CardUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Card Card_accountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Card"
    ADD CONSTRAINT "Card_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public."Account"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Card Card_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Card"
    ADD CONSTRAINT "Card_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Card Card_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Card"
    ADD CONSTRAINT "Card_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Category Category_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Category"
    ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public."Category"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Category Category_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Category"
    ADD CONSTRAINT "Category_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Category Category_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Category"
    ADD CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Person Person_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Person"
    ADD CONSTRAINT "Person_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Person Person_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Person"
    ADD CONSTRAINT "Person_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectInvitation ProjectInvitation_invitedByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectInvitation"
    ADD CONSTRAINT "ProjectInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES public."User"(id);


--
-- Name: ProjectInvitation ProjectInvitation_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectInvitation"
    ADD CONSTRAINT "ProjectInvitation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectMember ProjectMember_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectMember"
    ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectMember ProjectMember_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProjectMember"
    ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Transaction Transaction_accountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Transaction"
    ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public."Account"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Transaction Transaction_cardId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Transaction"
    ADD CONSTRAINT "Transaction_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES public."Card"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Transaction Transaction_mainCategoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Transaction"
    ADD CONSTRAINT "Transaction_mainCategoryId_fkey" FOREIGN KEY ("mainCategoryId") REFERENCES public."Category"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Transaction Transaction_personId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Transaction"
    ADD CONSTRAINT "Transaction_personId_fkey" FOREIGN KEY ("personId") REFERENCES public."Person"(id);


--
-- Name: Transaction Transaction_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Transaction"
    ADD CONSTRAINT "Transaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Transaction Transaction_subCategoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Transaction"
    ADD CONSTRAINT "Transaction_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES public."Category"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Transaction Transaction_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Transaction"
    ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- PostgreSQL database dump complete
--

\unrestrict AKknmdkRrTzNodmrlcOgxQV2uvQApVXLH3BdU85l3Eykv5AHihacXqnObb7Jcut

