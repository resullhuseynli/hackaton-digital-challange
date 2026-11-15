# AI istifadəsi haqqında bəyannamə (AI Declaration)

**Layihə:** Bakı Təxliyə və Dispetçer Platforması
**Tarix:** 15.11.2026

Bu sənəd layihənin hazırlanmasında hansı süni intellekt (AI) alətlərindən, hansı mərhələdə və necə
istifadə edildiyini açıq şəkildə göstərir. Komanda AI tərəfindən yaradılan bütün kodu və sənədləri
nəzərdən keçirib, işə salıb, testlərlə yoxlayıb və nəticəyə görə tam məsuliyyət daşıyır.

> ⚠️ **Təqdim etməzdən əvvəl:** aşağıdakı cədvəl repozitoriyada iz qoyan alətlərə əsasən doldurulub
> (`.claude/agents/`, `frontend/FRONTEND_PROMPT*.md`, `.claude/settings.local.json`). Komanda digər
> alətlərdən (Cursor, GitHub Copilot, ChatGPT və s.) istifadə edibsə, 1-ci bölmədəki boş sətri doldurun;
> istifadə etməyibsə, həmin sətri silin.

---

## 1. İstifadə olunan AI alətləri

| Alət | Model | Harada işlədilib | Rolu |
| --- | --- | --- | --- |
| **Claude Code** (VS Code genişlənməsi, CLI) | Anthropic Claude | Bütün repozitoriya | Əsas kodlaşdırma agenti: kod yazma, refaktorinq, test yazma və işə salma, sənədləşdirmə |
| Claude Code subagentləri `backend`, `frontend` | eyni | `backend/`, `frontend/` | Hər qovluq üçün ayrıca, məhdud səlahiyyətli agentlər (`.claude/agents/*.md`) |
| **Claude in Chrome** | eyni | `localhost:5173` | Qəbul meyarlarının real brauzerdə (headless Chrome) yoxlanması |
| _[digər alət, əgər istifadə olunubsa]_ | | | |

## 2. Mərhələlər üzrə istifadə

### 2.1 Tələblərin təhlili və arxitektura seçimi

- **AI nə etdi:** tapşırıq mətnini təhlil edib komponentləri (marşrutlaşdırma, SOS triage, crisis engine,
  real-time) təklif etdi; texnologiya alternativlərini müqayisə etdi (məs. Socket.IO yerinə native
  WebSocket + Redis pub/sub, NetworkX A* + PostGIS).
- **İnsan nə etdi:** stack-i (FastAPI + PostgreSQL/PostGIS + Redis, React + Vite) və əsas dizayn
  qərarlarını (hədd müqayisələrinin inklüziv olması, yolun iki istiqamətdə bağlanması, bir tranzaksiyada
  RED ALERT təsdiqi) komanda qəbul etdi. Qərarlar `backend/README.md` → “Design decisions” bölməsində qeyd olunub.

### 2.2 Kodun yazılması

- **Backend:** FastAPI endpoint-ləri, SQLAlchemy/GeoAlchemy2 modelləri, Alembic miqrasiyaları
  (0001–0006), domen servisləri, seed məlumatları Claude Code `backend` subagenti ilə yazılıb.
- **Frontend:** komanda tərəfindən hazırlanmış yazılı tapşırıq faylları
  ([FRONTEND_PROMPT.md](../frontend/FRONTEND_PROMPT.md),
  [FRONTEND_PROMPT_ROUTING_FALLBACK.md](../frontend/FRONTEND_PROMPT_ROUTING_FALLBACK.md)) əsasında
  Claude Code `frontend` subagenti ilə qurulub. Bu fayllar API müqaviləsini, ekranları və qəbul meyarlarını təsvir edir.
- **Nəzarət:** subagent təlimatları sirr saxlamağı qadağan edir, mövcud konvensiyalara riayət etməyi, test
  yazıb işə salmağı və yoxlanmamış hissələri açıq bildirməyi tələb edir. Paylaşılan mühitlərdə miqrasiya,
  deploy və dağıdıcı əməliyyatlar yalnız insan təsdiqi ilə.

### 2.3 Testlər

- **AI nə etdi:** backend üçün pytest testləri (127 test funksiyası: crisis engine sərhəd halları — 3 və 4
  vətəndaş, 499 m və 501 m, 4:59 və 5:01; reroute hədləri; təsdiq atomluğu; circuit breaker; flood qorunması;
  i18n paritet) və frontend üçün Vitest testləri yazdı və işə saldı. Yük testi skriptlərini
  (`load_test.py`, `k6_burst.js`) hazırladı.
- **Claude in Chrome:** frontend README-dəki AC1–AC9 qəbul meyarları işləyən backend üzərində brauzerdə yoxlandı.
- **İnsan nə etdi:** test ssenarilərinin tapşırığa uyğunluğunu, sərhəd dəyərlərini və nəticələri yoxladı;
  demo ssenarisini (`scripts/demo.py`) əl ilə keçdi.

### 2.4 Challenge Drop həlləri

| Drop | AI-nin rolu | İnsanın rolu |
| --- | --- | --- |
| Hərəkət məhdudiyyətli şəxslər | Miqrasiyalar 0002–0003, pilləkənsiz A*, maneə modeli, UI əlçatanlıq elementləri | Prioritet qaydasının (həmişə #1) və “marşrut tapılmasa nə olsun” davranışının seçimi |
| Xarici routing API-nin sıradan çıxması | Circuit breaker, fallback zənciri, mock provider + fault injection, frontend banner | Fallback sırasının və “bağlı yola toxunan xarici marşrutu rədd et” təhlükəsizlik qaydasının təsdiqi |
| SOS flood / spam | Qatlı anti-spam, karantin, RBAC, yük testi | “Fail-open” siyasəti və CGNAT-a görə yumşaq IP limitlərinin seçimi |
| Yük altında performans | Asinxron crisis növbəsi, miqrasiya 0006, profil skripti | Nəticələrin yük testi ilə təsdiqi |

### 2.5 Sənədləşdirmə

`backend/README.md`, `frontend/README.md`, `docs/README.md`, bu bəyannamə və `docs/Texniki_Izah.docx`
Claude Code ilə hazırlanıb, komanda tərəfindən redaktə və təsdiq edilib.

## 3. AI-nin istifadə edilmədiyi sahələr

- Real vətəndaş və ya şəxsi məlumatlar AI alətlərinə ötürülməyib; seed məlumatları sintetikdir.
- Produksiya sirləri (parol, açar) AI-yə verilməyib; repozitoriyada yalnız demo dəyərləri var.

## 4. Keyfiyyət və məsuliyyət

- AI-nin yazdığı hər dəyişiklik testlər, frontend-də lint/typecheck (ESLint, `tsc`) və işləyən sistem üzərində demo ilə yoxlanılıb.
- Əsas arxitektura və təhlükəsizlik qərarları insan tərəfindən qəbul edilib.
- Komanda kodun bütün hissələrini izah edə bilir və ona görə tam məsuliyyət daşıyır.
