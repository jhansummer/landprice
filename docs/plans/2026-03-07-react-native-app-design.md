# APT Mine React Native 앱 설계

**날짜:** 2026-03-07
**목표:** aptmine.com을 Google Play + App Store에 출시 가능한 React Native 앱으로 개발

---

## 1. 전체 아키텍처

```
Expo (React Native + TypeScript)
    ├── GitHub Pages JSON (기존 시세 데이터, 그대로 fetch)
    └── Supabase
          ├── Auth (카카오 / 네이버 / 구글 소셜 로그인)
          ├── PostgreSQL (관심목록, 알림 설정, 발송 로그)
          └── Edge Functions (매일 cron → 신고가/저평가 감지 → Expo Push API)
```

---

## 2. 화면 구조 & 내비게이션

**Bottom Tab Navigator (5탭)**
- 🏠 홈 — 시장 요약 대시보드
- 🔍 검색 — 아파트 검색 + 자동완성
- 📈 시세 — 지역별 시세 (시도/구군)
- 💡 분석 — 저평가 / 신고가 / 밸류에이션 / 바닥찾기 / 백테스트 / 전세
- ⭐ 관심 — 찜 목록 (로그인 시 기기 간 동기화)

**공통 Stack (어느 탭에서도 진입)**
- 아파트 상세 — 실거래 차트, 전세가율, 비교

**로그인:** 관심 탭 첫 진입 시 소셜 로그인 bottom sheet 노출 (강제 아님)
**알림 설정:** 관심 탭 내 설정 화면 → 신고가 / 저평가 알림 ON/OFF

---

## 3. Supabase 스키마

```sql
-- 관심목록
watchlist (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users,
  apt_code text,
  apt_name text,
  sido text,
  district text,
  created_at timestamptz DEFAULT now()
)

-- 알림 설정
notification_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users,
  newhigh_enabled boolean DEFAULT true,
  undervalued_enabled boolean DEFAULT true
)

-- 알림 발송 로그 (중복 방지)
notification_log (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users,
  apt_code text,
  type text CHECK (type IN ('newhigh', 'undervalued')),
  sent_at timestamptz DEFAULT now()
)
```

**알림 흐름:**
매일 GitHub Pages 데이터 갱신 → Supabase Edge Function (cron) → 관심목록 아파트 중 신고가/저평가 변동 감지 → Expo Push Notification API → 기기 푸시 발송

---

## 4. 기술 스택

| 역할 | 라이브러리 |
|------|-----------|
| 프레임워크 | Expo SDK 52 + TypeScript |
| 내비게이션 | React Navigation 7 (Bottom Tab + Stack) |
| 상태관리 | Zustand |
| 데이터 fetch | TanStack Query |
| 차트 | Victory Native |
| 소셜 로그인 | Supabase Auth + expo-auth-session |
| 푸시 알림 | expo-notifications |
| 스타일 | NativeWind (Tailwind → RN) |
| 앱스토어 빌드 | EAS Build |

---

## 5. 개발 순서 (큰 그림)

1. Expo 프로젝트 초기화 + 기본 내비게이션
2. 기존 JSON 데이터 연동 (홈, 검색, 시세, 분석 화면)
3. 아파트 상세 화면 + 차트
4. Supabase 연동 (Auth + 관심목록)
5. 소셜 로그인 (구글 → 카카오 → 네이버 순)
6. 푸시 알림 (Edge Function + expo-notifications)
7. EAS Build → 스토어 제출
