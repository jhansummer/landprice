---
render_with_liquid: false
---
# APT Mine React Native App 구현 플랜

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** aptmine.com을 Expo + Supabase 기반 React Native 앱으로 개발해 Google Play + App Store에 출시

**Architecture:** Expo SDK 52 + TypeScript 앱. 기존 aptmine.com JSON 데이터를 TanStack Query로 fetch. 사용자 인증/관심목록/알림은 Supabase 처리.

**Tech Stack:** Expo 52, TypeScript, React Navigation 7, Zustand, TanStack Query, Victory Native, NativeWind, Supabase, EAS Build

**Data Base URL:** `https://aptmine.com/`

**Data Endpoints:**
- `data/apt_trade/summary.json` — 홈/시세/전세 요약
- `data/apt_trade/newhigh_summary.json` — 신고가
- `data/apt_trade/undervalued.json` — 저평가
- `data/apt_trade/bottom/index.json` + `bottom/{sido}.json` — 바닥찾기
- `data/apt_trade/backtest.json` — 백테스트
- `data/apt_trade/by_apt/{id}.json` — 아파트 상세
- `data/apt_trade/search/{sido}.json` — 검색
- `data/apt_trade/valuation/index.json` — 밸류에이션
- `data/apt_trade/valuation_geo.json`, `location_scores.json` — 보조 데이터

---

## Phase 1: 프로젝트 초기화

### Task 1: Expo 프로젝트 생성

**Files:**
- Create: `aptmine-app/` (새 디렉토리, landprice 외부)

**Step 1: Expo 프로젝트 생성**

{% raw %}
{% raw %}
```bash
cd /Users/hanjin
npx create-expo-app aptmine-app --template blank-typescript
cd aptmine-app
```
{% endraw %}
{% endraw %}

**Step 2: 기본 패키지 설치**

{% raw %}
{% raw %}
```bash
npx expo install expo-router react-native-safe-area-context react-native-screens
npx expo install @react-navigation/native @react-navigation/bottom-tabs @react-navigation/native-stack
npx expo install @tanstack/react-query zustand
npx expo install @supabase/supabase-js
npx expo install expo-secure-store expo-constants expo-notifications
npx expo install expo-auth-session expo-web-browser expo-crypto
npx expo install victory-native react-native-svg react-native-reanimated
npx expo install @react-native-async-storage/async-storage
```
{% endraw %}
{% endraw %}

**Step 3: NativeWind 설치**

{% raw %}
{% raw %}
```bash
npm install nativewind
npm install --save-dev tailwindcss
npx tailwindcss init
```
{% endraw %}
{% endraw %}

**Step 4: app.json 수정**

{% raw %}
{% raw %}
```json
{
  "expo": {
    "name": "APT Mine",
    "slug": "aptmine",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "splash": { "image": "./assets/splash.png", "backgroundColor": "#0f172a" },
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "com.aptmine.app"
    },
    "android": {
      "adaptiveIcon": { "foregroundImage": "./assets/adaptive-icon.png", "backgroundColor": "#0f172a" },
      "package": "com.aptmine.app"
    },
    "plugins": ["expo-router", "expo-notifications"]
  }
}
```
{% endraw %}
{% endraw %}

**Step 5: babel.config.js 수정 (NativeWind)**

{% raw %}
{% raw %}
```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['nativewind/babel'],
  };
};
```
{% endraw %}
{% endraw %}

**Step 6: tailwind.config.js**

{% raw %}
{% raw %}
```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#2563eb',
        'primary-dark': '#1e40af',
        surface: '#0f172a',
        card: '#1e293b',
        muted: '#64748b',
        up: '#2563eb',
        down: '#ef4444',
      },
    },
  },
  plugins: [],
};
```
{% endraw %}
{% endraw %}

**Step 7: 실행 확인**

{% raw %}
{% raw %}
```bash
npx expo start
```
{% endraw %}
{% endraw %}

Expo Go 앱에서 QR 스캔해서 기본 화면 확인

**Step 8: 커밋**

{% raw %}
{% raw %}
```bash
git init && git add . && git commit -m "chore: Expo 프로젝트 초기화"
```
{% endraw %}
{% endraw %}

---

### Task 2: 폴더 구조 + 내비게이션 설정

**Files:**
- Create: `app/_layout.tsx`
- Create: `app/(tabs)/_layout.tsx`
- Create: `app/(tabs)/index.tsx`
- Create: `app/(tabs)/search.tsx`
- Create: `app/(tabs)/regional.tsx`
- Create: `app/(tabs)/analysis.tsx`
- Create: `app/(tabs)/watchlist.tsx`
- Create: `app/apt/[id].tsx`

**Step 1: 폴더 구조 생성**

{% raw %}
{% raw %}
```bash
mkdir -p app/(tabs) app/apt components/ui components/charts lib
```
{% endraw %}
{% endraw %}

**Step 2: app/_layout.tsx**

{% raw %}
{% raw %}
```tsx
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
```
{% endraw %}
{% endraw %}

**Step 3: app/(tabs)/_layout.tsx**

{% raw %}
{% raw %}
```tsx
import { Tabs } from 'expo-router';
import { Text } from 'react-native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: { backgroundColor: '#fff', borderTopColor: '#e2e8f0' },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '홈', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🏠</Text> }} />
      <Tabs.Screen name="search" options={{ title: '검색', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🔍</Text> }} />
      <Tabs.Screen name="regional" options={{ title: '시세', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📈</Text> }} />
      <Tabs.Screen name="analysis" options={{ title: '분석', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>💡</Text> }} />
      <Tabs.Screen name="watchlist" options={{ title: '관심', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>⭐</Text> }} />
    </Tabs>
  );
}
```
{% endraw %}
{% endraw %}

**Step 4: 각 탭 placeholder 파일 생성**

{% raw %}
{% raw %}
```tsx
// app/(tabs)/index.tsx
import { View, Text } from 'react-native';
export default function HomeScreen() {
  return <View className="flex-1 items-center justify-center"><Text>홈</Text></View>;
}
```
{% endraw %}
{% endraw %}
search.tsx, regional.tsx, analysis.tsx, watchlist.tsx 동일 패턴

**Step 5: app/apt/[id].tsx**

{% raw %}
{% raw %}
```tsx
import { View, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
export default function AptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <View className="flex-1 items-center justify-center"><Text>아파트: {id}</Text></View>;
}
```
{% endraw %}
{% endraw %}

**Step 6: 실행 확인** — 5개 탭이 화면 하단에 보여야 함

**Step 7: 커밋**

{% raw %}
{% raw %}
```bash
git add . && git commit -m "feat: 탭 내비게이션 기본 구조"
```
{% endraw %}
{% endraw %}

---

### Task 3: 공통 컴포넌트 + API 클라이언트

**Files:**
- Create: `lib/api.ts`
- Create: `components/ui/Card.tsx`
- Create: `components/ui/Badge.tsx`
- Create: `components/ui/LoadingView.tsx`
- Create: `components/ui/ErrorView.tsx`

**Step 1: lib/api.ts**

{% raw %}
{% raw %}
```ts
const BASE = 'https://aptmine.com/';
const TS = () => `?t=${Date.now()}`;

export const api = {
  summary: () => fetch(`${BASE}data/apt_trade/summary.json${TS()}`).then(r => r.json()),
  newhigh: () => fetch(`${BASE}data/apt_trade/newhigh_summary.json${TS()}`).then(r => r.json()),
  undervalued: () => fetch(`${BASE}data/apt_trade/undervalued.json${TS()}`).then(r => r.json()),
  bottomIndex: () => fetch(`${BASE}data/apt_trade/bottom/index.json${TS()}`).then(r => r.json()),
  bottomBySido: (sido: string) => fetch(`${BASE}data/apt_trade/bottom/${encodeURIComponent(sido)}.json${TS()}`).then(r => r.json()),
  backtest: () => fetch(`${BASE}data/apt_trade/backtest.json${TS()}`).then(r => r.json()),
  aptDetail: (id: string) => fetch(`${BASE}data/apt_trade/by_apt/${id}.json${TS()}`).then(r => r.json()),
  searchBySido: (sido: string) => fetch(`${BASE}data/apt_trade/search/${encodeURIComponent(sido)}.json${TS()}`).then(r => r.json()),
  valuation: () => fetch(`${BASE}data/apt_trade/valuation/index.json${TS()}`).then(r => r.json()),
  valuationGeo: () => fetch(`${BASE}data/apt_trade/valuation_geo.json${TS()}`).then(r => r.json()),
  locationScores: () => fetch(`${BASE}data/apt_trade/location_scores.json${TS()}`).then(r => r.json()),
};
```
{% endraw %}
{% endraw %}

**Step 2: components/ui/Card.tsx**

{% raw %}
{% raw %}
```tsx
import { View, ViewProps } from 'react-native';

export function Card({ children, className = '', ...props }: ViewProps & { className?: string }) {
  return (
    <View className={`bg-white rounded-2xl p-4 shadow-sm border border-slate-100 ${className}`} {...props}>
      {children}
    </View>
  );
}
```
{% endraw %}
{% endraw %}

**Step 3: components/ui/LoadingView.tsx**

{% raw %}
{% raw %}
```tsx
import { View, ActivityIndicator } from 'react-native';

export function LoadingView() {
  return (
    <View className="flex-1 items-center justify-center bg-slate-50">
      <ActivityIndicator size="large" color="#2563eb" />
    </View>
  );
}
```
{% endraw %}
{% endraw %}

**Step 4: components/ui/ErrorView.tsx**

{% raw %}
{% raw %}
```tsx
import { View, Text, TouchableOpacity } from 'react-native';

export function ErrorView({ onRetry }: { onRetry?: () => void }) {
  return (
    <View className="flex-1 items-center justify-center bg-slate-50 p-6">
      <Text className="text-slate-500 text-base mb-4">데이터를 불러오지 못했습니다</Text>
      {onRetry && (
        <TouchableOpacity onPress={onRetry} className="bg-primary px-6 py-3 rounded-xl">
          <Text className="text-white font-bold">다시 시도</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
```
{% endraw %}
{% endraw %}

**Step 5: components/ui/Badge.tsx**

{% raw %}
{% raw %}
```tsx
import { Text, View } from 'react-native';

type BadgeType = 'recovered' | 'rising' | 'flat' | 'falling';
const BADGE_STYLES: Record<BadgeType, string> = {
  recovered: 'bg-blue-100 text-blue-800',
  rising:    'bg-green-100 text-green-800',
  flat:      'bg-slate-100 text-slate-600',
  falling:   'bg-red-100 text-red-700',
};
const BADGE_LABELS: Record<BadgeType, string> = {
  recovered: '상승', rising: '회복', flat: '횡보', falling: '하락',
};

export function Badge({ type }: { type: BadgeType }) {
  return (
    <View className={`rounded-full px-2 py-0.5 ${BADGE_STYLES[type].split(' ')[0]}`}>
      <Text className={`text-xs font-bold ${BADGE_STYLES[type].split(' ')[1]}`}>
        {BADGE_LABELS[type]}
      </Text>
    </View>
  );
}
```
{% endraw %}
{% endraw %}

**Step 6: 커밋**

{% raw %}
{% raw %}
```bash
git add . && git commit -m "feat: API 클라이언트 + 공통 UI 컴포넌트"
```
{% endraw %}
{% endraw %}

---

## Phase 2: 핵심 화면

### Task 4: 홈 화면 (대시보드)

**Files:**
- Modify: `app/(tabs)/index.tsx`

**Step 1: summary.json 구조 확인**

실제 앱에서 fetch 후 console.log로 확인:
{% raw %}
{% raw %}
```bash
curl https://aptmine.com/data/apt_trade/summary.json | python3 -m json.tool | head -50
```
{% endraw %}
{% endraw %}

**Step 2: useSummary 훅 작성**

`lib/hooks.ts` 생성:
{% raw %}
{% raw %}
```ts
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const useSummary = () => useQuery({ queryKey: ['summary'], queryFn: api.summary });
export const useNewhigh = () => useQuery({ queryKey: ['newhigh'], queryFn: api.newhigh });
export const useUndervalued = () => useQuery({ queryKey: ['undervalued'], queryFn: api.undervalued });
export const useAptDetail = (id: string) => useQuery({ queryKey: ['apt', id], queryFn: () => api.aptDetail(id), enabled: !!id });
export const useSearch = (sido: string) => useQuery({ queryKey: ['search', sido], queryFn: () => api.searchBySido(sido), enabled: !!sido });
export const useBacktest = () => useQuery({ queryKey: ['backtest'], queryFn: api.backtest });
export const useValuation = () => useQuery({ queryKey: ['valuation'], queryFn: api.valuation });
export const useBottomIndex = () => useQuery({ queryKey: ['bottom-index'], queryFn: api.bottomIndex });
```
{% endraw %}
{% endraw %}

**Step 3: 홈 화면 구현**

{% raw %}
{% raw %}
```tsx
// app/(tabs)/index.tsx
import { ScrollView, View, Text, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSummary } from '../../lib/hooks';
import { Card } from '../../components/ui/Card';
import { LoadingView } from '../../components/ui/LoadingView';
import { ErrorView } from '../../components/ui/ErrorView';

function fmt(v: number) {
  if (v >= 10000) return (v / 10000).toFixed(1) + '억';
  return Math.round(v).toLocaleString('ko-KR') + '만';
}

export default function HomeScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useSummary();

  if (isLoading) return <LoadingView />;
  if (isError) return <ErrorView onRetry={refetch} />;

  // summary.json 실제 구조에 맞게 조정 필요
  const summary = data;

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#2563eb" />}
        contentContainerStyle={{ padding: 16, gap: 12 }}
      >
        <Text className="text-2xl font-black text-slate-900 mb-2">APT Mine</Text>

        <Card>
          <Text className="text-xs font-bold text-slate-500 mb-1">시장 요약</Text>
          <Text className="text-sm text-slate-700 leading-6">
            {summary?.market_summary ?? '데이터 로딩 중...'}
          </Text>
        </Card>

        {/* 추가 대시보드 카드 - summary.json 구조 파악 후 구현 */}
      </ScrollView>
    </SafeAreaView>
  );
}
```
{% endraw %}
{% endraw %}

**Step 4: 실행 확인** — 홈에서 summary 데이터 로드, pull-to-refresh 동작

**Step 5: 커밋**

{% raw %}
{% raw %}
```bash
git add . && git commit -m "feat: 홈 화면 + TanStack Query 연동"
```
{% endraw %}
{% endraw %}

---

### Task 5: 검색 화면

**Files:**
- Modify: `app/(tabs)/search.tsx`
- Create: `components/AptListItem.tsx`

**Step 1: 시도 목록 상수 정의**

`lib/constants.ts`:
{% raw %}
{% raw %}
```ts
export const SIDO_LIST = [
  '서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];
```
{% endraw %}
{% endraw %}

**Step 2: AptListItem 컴포넌트**

{% raw %}
{% raw %}
```tsx
// components/AptListItem.tsx
import { TouchableOpacity, View, Text } from 'react-native';
import { router } from 'expo-router';

interface AptItem {
  id: string;
  name: string;
  sido: string;
  district: string;
  price?: number;
}

export function AptListItem({ item }: { item: AptItem }) {
  return (
    <TouchableOpacity
      onPress={() => router.push(`/apt/${item.id}`)}
      className="bg-white border-b border-slate-100 px-4 py-3 flex-row items-center justify-between"
    >
      <View className="flex-1 min-w-0">
        <Text className="text-sm font-bold text-slate-900" numberOfLines={1}>{item.name}</Text>
        <Text className="text-xs text-slate-500">{item.sido} {item.district}</Text>
      </View>
      {item.price && (
        <Text className="text-sm font-bold text-primary ml-2">
          {item.price >= 10000 ? (item.price / 10000).toFixed(1) + '억' : item.price.toLocaleString() + '만'}
        </Text>
      )}
    </TouchableOpacity>
  );
}
```
{% endraw %}
{% endraw %}

**Step 3: 검색 화면 구현**

{% raw %}
{% raw %}
```tsx
// app/(tabs)/search.tsx
import { useState, useMemo } from 'react';
import { View, TextInput, FlatList, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSearch } from '../../lib/hooks';
import { AptListItem } from '../../components/AptListItem';
import { SIDO_LIST } from '../../lib/constants';
import { LoadingView } from '../../components/ui/LoadingView';

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [activeSido, setActiveSido] = useState('서울');
  const { data, isLoading } = useSearch(activeSido);

  const filtered = useMemo(() => {
    if (!data || !query.trim()) return data ?? [];
    const q = query.trim().toLowerCase();
    return data.filter((item: any) =>
      item.name?.toLowerCase().includes(q) || item.district?.toLowerCase().includes(q)
    );
  }, [data, query]);

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="px-4 pt-4 pb-2">
        <TextInput
          className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900"
          placeholder="아파트명 또는 지역 검색"
          value={query}
          onChangeText={setQuery}
          clearButtonMode="while-editing"
        />
      </View>

      {/* 시도 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-4 py-2 max-h-12">
        {SIDO_LIST.map(sido => (
          <TouchableOpacity
            key={sido}
            onPress={() => setActiveSido(sido)}
            className={`mr-2 px-3 py-1.5 rounded-full ${activeSido === sido ? 'bg-primary' : 'bg-white border border-slate-200'}`}
          >
            <Text className={`text-xs font-bold ${activeSido === sido ? 'text-white' : 'text-slate-600'}`}>{sido}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {isLoading ? (
        <LoadingView />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item: any) => item.id}
          renderItem={({ item }) => <AptListItem item={item} />}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </SafeAreaView>
  );
}
```
{% endraw %}
{% endraw %}

**Step 4: 실행 확인** — 시도 선택, 검색어 입력 시 필터링, 항목 탭 시 아파트 상세 이동

**Step 5: 커밋**

{% raw %}
{% raw %}
```bash
git add . && git commit -m "feat: 검색 화면"
```
{% endraw %}
{% endraw %}

---

### Task 6: 시세 화면 (지역별)

**Files:**
- Modify: `app/(tabs)/regional.tsx`

summary.json에 시도별 시세 데이터가 포함되어 있음.

**Step 1: 시세 화면 구현**

{% raw %}
{% raw %}
```tsx
// app/(tabs)/regional.tsx
import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSummary } from '../../lib/hooks';
import { Card } from '../../components/ui/Card';
import { LoadingView } from '../../components/ui/LoadingView';
import { ErrorView } from '../../components/ui/ErrorView';
import { SIDO_LIST } from '../../lib/constants';
import { router } from 'expo-router';

export default function RegionalScreen() {
  const [activeSido, setActiveSido] = useState('서울');
  const { data, isLoading, isError, refetch, isRefetching } = useSummary();

  if (isLoading) return <LoadingView />;
  if (isError) return <ErrorView onRetry={refetch} />;

  // summary.json 실제 구조에 맞게 조정
  const sidoData = data?.by_sido?.[activeSido] ?? [];

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      {/* 시도 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="max-h-12 py-2 px-4">
        {SIDO_LIST.map(sido => (
          <TouchableOpacity
            key={sido}
            onPress={() => setActiveSido(sido)}
            className={`mr-2 px-3 py-1.5 rounded-full ${activeSido === sido ? 'bg-primary' : 'bg-white border border-slate-200'}`}
          >
            <Text className={`text-xs font-bold ${activeSido === sido ? 'text-white' : 'text-slate-600'}`}>{sido}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={sidoData}
        keyExtractor={(item: any) => item.id ?? item.name}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#2563eb" />}
        renderItem={({ item }: any) => (
          <TouchableOpacity onPress={() => router.push(`/apt/${item.id}`)} className="bg-white border-b border-slate-100 px-4 py-3">
            <Text className="text-sm font-bold text-slate-900">{item.name}</Text>
            <Text className="text-xs text-slate-500">{item.district}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<View className="p-8 items-center"><Text className="text-slate-400">데이터가 없습니다</Text></View>}
      />
    </SafeAreaView>
  );
}
```
{% endraw %}
{% endraw %}

**Step 2: summary.json 실제 구조 확인 후 필드명 수정**

{% raw %}
{% raw %}
```bash
curl https://aptmine.com/data/apt_trade/summary.json | python3 -m json.tool | head -80
```
{% endraw %}
{% endraw %}

**Step 3: 실행 확인**

**Step 4: 커밋**

{% raw %}
{% raw %}
```bash
git add . && git commit -m "feat: 시세 화면"
```
{% endraw %}
{% endraw %}

---

### Task 7: 분석 화면 (저평가 + 신고가)

**Files:**
- Modify: `app/(tabs)/analysis.tsx`
- Create: `app/analysis/undervalued.tsx`
- Create: `app/analysis/newhigh.tsx`

**Step 1: 분석 메뉴 화면**

{% raw %}
{% raw %}
```tsx
// app/(tabs)/analysis.tsx
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

const MENUS = [
  { icon: '💡', title: '저평가 단지', desc: '인근 대비 저렴한 아파트', href: '/analysis/undervalued' },
  { icon: '🚀', title: '신고가 단지', desc: '최근 역대 최고가 갱신', href: '/analysis/newhigh' },
  { icon: '📊', title: '밸류에이션', desc: '적정가 대비 분석', href: '/analysis/valuation' },
  { icon: '📉', title: '바닥 찾기', desc: '고점 대비 하락 단지', href: '/analysis/bottom' },
  { icon: '🔬', title: '백테스트', desc: '과거 데이터 시뮬레이션', href: '/analysis/backtest' },
  { icon: '🏠', title: '전세가율', desc: '전세가율 높은 단지', href: '/analysis/jeonse' },
];

export default function AnalysisScreen() {
  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-black text-slate-900">분석</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        {MENUS.map(menu => (
          <TouchableOpacity
            key={menu.href}
            onPress={() => router.push(menu.href as any)}
            className="bg-white rounded-2xl p-4 flex-row items-center border border-slate-100 shadow-sm"
          >
            <Text className="text-3xl mr-4">{menu.icon}</Text>
            <View>
              <Text className="text-base font-bold text-slate-900">{menu.title}</Text>
              <Text className="text-xs text-slate-500">{menu.desc}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
```
{% endraw %}
{% endraw %}

**Step 2: 저평가 화면 (app/analysis/undervalued.tsx)**

{% raw %}
{% raw %}
```bash
mkdir -p app/analysis
```
{% endraw %}
{% endraw %}

{% raw %}
{% raw %}
```tsx
import { FlatList, View, Text, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { useUndervalued } from '../../lib/hooks';
import { LoadingView } from '../../components/ui/LoadingView';
import { ErrorView } from '../../components/ui/ErrorView';
import { Badge } from '../../components/ui/Badge';

export default function UndervaluedScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useUndervalued();
  if (isLoading) return <LoadingView />;
  if (isError) return <ErrorView onRetry={refetch} />;

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <Stack.Screen options={{ title: '저평가 단지', headerShown: true }} />
      <FlatList
        data={data}
        keyExtractor={(item: any) => item.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#2563eb" />}
        renderItem={({ item }: any) => (
          <TouchableOpacity
            onPress={() => router.push(`/apt/${item.id}`)}
            className="bg-white border-b border-slate-100 px-4 py-3 flex-row justify-between items-center"
          >
            <View className="flex-1 min-w-0 mr-3">
              <Text className="text-sm font-bold text-slate-900" numberOfLines={1}>{item.name}</Text>
              <Text className="text-xs text-slate-500">{item.sido} {item.district}</Text>
            </View>
            <View className="items-end gap-1">
              <Text className="text-sm font-bold text-primary">
                {item.price >= 10000 ? (item.price / 10000).toFixed(1) + '억' : item.price?.toLocaleString() + '만'}
              </Text>
              {item.status && <Badge type={item.status} />}
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}
```
{% endraw %}
{% endraw %}

**Step 3: 신고가 화면 (동일 패턴으로 app/analysis/newhigh.tsx 작성)**

useNewhigh() 훅 사용, 필드명 실제 API에 맞게 조정

**Step 4: 실행 확인** — 분석 메뉴 탭 → 저평가/신고가 진입

**Step 5: 커밋**

{% raw %}
{% raw %}
```bash
git add . && git commit -m "feat: 분석 화면 (저평가, 신고가)"
```
{% endraw %}
{% endraw %}

---

### Task 8: 밸류에이션 / 바닥찾기 / 백테스트 / 전세 화면

**Files:**
- Create: `app/analysis/valuation.tsx`
- Create: `app/analysis/bottom.tsx`
- Create: `app/analysis/backtest.tsx`
- Create: `app/analysis/jeonse.tsx`

각 화면 동일 패턴으로 구현:
- 해당 hook 사용 (useValuation, useBottomIndex, useBacktest, useSummary)
- FlatList + Card 레이아웃
- 아파트 상세로 연결

**Step 1: 각 화면 실제 API 구조 확인**

{% raw %}
{% raw %}
```bash
curl https://aptmine.com/data/apt_trade/valuation/index.json | python3 -m json.tool | head -40
curl https://aptmine.com/data/apt_trade/bottom/index.json | python3 -m json.tool | head -40
curl https://aptmine.com/data/apt_trade/backtest.json | python3 -m json.tool | head -40
```
{% endraw %}
{% endraw %}

**Step 2: 각 화면 구현** (valuation.tsx 예시)

{% raw %}
{% raw %}
```tsx
import { FlatList, View, Text, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { useValuation } from '../../lib/hooks';
import { LoadingView } from '../../components/ui/LoadingView';
import { ErrorView } from '../../components/ui/ErrorView';

export default function ValuationScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useValuation();
  if (isLoading) return <LoadingView />;
  if (isError) return <ErrorView onRetry={refetch} />;
  // 실제 data 구조에 맞게 렌더링
  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <Stack.Screen options={{ title: '밸류에이션', headerShown: true }} />
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(item: any) => item.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#2563eb" />}
        renderItem={({ item }: any) => (
          <TouchableOpacity onPress={() => router.push(`/apt/${item.id}`)} className="bg-white border-b border-slate-100 px-4 py-3">
            <Text className="text-sm font-bold text-slate-900">{item.name}</Text>
            <Text className="text-xs text-slate-500">{item.sido} {item.district}</Text>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}
```
{% endraw %}
{% endraw %}

**Step 3: 실행 확인**

**Step 4: 커밋**

{% raw %}
{% raw %}
```bash
git add . && git commit -m "feat: 밸류에이션/바닥찾기/백테스트/전세 화면"
```
{% endraw %}
{% endraw %}

---

### Task 9: 아파트 상세 화면 + 차트

**Files:**
- Modify: `app/apt/[id].tsx`
- Create: `components/charts/PriceChart.tsx`

**Step 1: 실거래가 차트 컴포넌트**

{% raw %}
{% raw %}
```tsx
// components/charts/PriceChart.tsx
import { VictoryLine, VictoryChart, VictoryAxis, VictoryTheme } from 'victory-native';
import { View, Text, Dimensions } from 'react-native';

const WIDTH = Dimensions.get('window').width - 48;

interface Trade {
  date: string;
  price: number;
  area: number;
}

export function PriceChart({ trades }: { trades: Trade[] }) {
  if (!trades?.length) return <Text className="text-xs text-slate-400 text-center py-4">거래 데이터 없음</Text>;

  const data = trades.map(t => ({ x: new Date(t.date), y: t.price / 10000 }));

  return (
    <View>
      <VictoryChart width={WIDTH} height={200} theme={VictoryTheme.material} padding={{ top: 10, bottom: 30, left: 50, right: 10 }}>
        <VictoryAxis tickFormat={d => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`} style={{ tickLabels: { fontSize: 9, angle: -30 } }} />
        <VictoryAxis dependentAxis tickFormat={y => `${y}억`} style={{ tickLabels: { fontSize: 9 } }} />
        <VictoryLine data={data} style={{ data: { stroke: '#2563eb', strokeWidth: 2 } }} />
      </VictoryChart>
    </View>
  );
}
```
{% endraw %}
{% endraw %}

**Step 2: 아파트 상세 화면**

{% raw %}
{% raw %}
```tsx
// app/apt/[id].tsx
import { ScrollView, View, Text, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useAptDetail } from '../../lib/hooks';
import { PriceChart } from '../../components/charts/PriceChart';
import { Card } from '../../components/ui/Card';
import { LoadingView } from '../../components/ui/LoadingView';
import { ErrorView } from '../../components/ui/ErrorView';

function fmt(v: number) {
  if (v >= 10000) return (v / 10000).toFixed(1) + '억';
  return Math.round(v).toLocaleString('ko-KR') + '만';
}

export default function AptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, refetch, isRefetching } = useAptDetail(id!);

  if (isLoading) return <LoadingView />;
  if (isError) return <ErrorView onRetry={refetch} />;

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <Stack.Screen options={{ title: data?.name ?? '아파트 상세', headerShown: true }} />
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#2563eb" />}
        contentContainerStyle={{ padding: 16, gap: 12 }}
      >
        {/* 기본 정보 */}
        <Card>
          <Text className="text-xl font-black text-slate-900 mb-1">{data?.name}</Text>
          <Text className="text-xs text-slate-500">{data?.sido} {data?.district} · {data?.households}세대</Text>
        </Card>

        {/* 최근 실거래 */}
        <Card>
          <Text className="text-sm font-bold text-slate-700 mb-3">실거래가 추이</Text>
          <PriceChart trades={data?.trades ?? []} />
        </Card>

        {/* 고점 대비 */}
        {data?.peak_price && (
          <Card>
            <Text className="text-sm font-bold text-slate-700 mb-2">고점 대비</Text>
            <View className="flex-row justify-between">
              <View><Text className="text-xs text-slate-500">고점가</Text><Text className="text-base font-bold text-slate-900">{fmt(data.peak_price)}</Text></View>
              <View><Text className="text-xs text-slate-500">현재가</Text><Text className="text-base font-bold text-slate-900">{fmt(data.current_price)}</Text></View>
              <View><Text className="text-xs text-slate-500">고점대비</Text><Text className={`text-base font-bold ${data.vs_peak < 0 ? 'text-red-500' : 'text-primary'}`}>{data.vs_peak?.toFixed(1)}%</Text></View>
            </View>
          </Card>
        )}

        {/* 전세가율 */}
        {data?.jeonse_ratio && (
          <Card>
            <Text className="text-sm font-bold text-slate-700 mb-1">전세가율</Text>
            <Text className="text-2xl font-black text-primary">{data.jeonse_ratio.toFixed(1)}%</Text>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
```
{% endraw %}
{% endraw %}

**Step 3: 실제 by_apt JSON 구조 확인 후 필드명 조정**

{% raw %}
{% raw %}
```bash
curl https://aptmine.com/data/apt_trade/by_apt/$(curl -s https://aptmine.com/data/apt_trade/search/서울.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'])" 2>/dev/null || echo "sample_id").json | python3 -m json.tool | head -60
```
{% endraw %}
{% endraw %}

**Step 4: 실행 확인** — 아파트 상세 → 차트 렌더링

**Step 5: 커밋**

{% raw %}
{% raw %}
```bash
git add . && git commit -m "feat: 아파트 상세 화면 + 실거래가 차트"
```
{% endraw %}
{% endraw %}

---

## Phase 3: 관심목록 (로컬)

### Task 10: 로컬 관심목록 (Zustand + AsyncStorage)

**Files:**
- Create: `lib/watchlist.ts`
- Modify: `app/(tabs)/watchlist.tsx`
- Modify: `app/apt/[id].tsx` (찜 버튼 추가)

**Step 1: Zustand 스토어**

{% raw %}
{% raw %}
```ts
// lib/watchlist.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface WatchItem {
  id: string;
  name: string;
  sido: string;
  district: string;
  addedAt: string;
}

interface WatchlistStore {
  items: WatchItem[];
  add: (item: Omit<WatchItem, 'addedAt'>) => void;
  remove: (id: string) => void;
  has: (id: string) => boolean;
}

export const useWatchlistStore = create<WatchlistStore>()(
  persist(
    (set, get) => ({
      items: [],
      add: (item) => set(s => ({
        items: s.items.some(i => i.id === item.id)
          ? s.items
          : [...s.items, { ...item, addedAt: new Date().toISOString() }],
      })),
      remove: (id) => set(s => ({ items: s.items.filter(i => i.id !== id) })),
      has: (id) => get().items.some(i => i.id === id),
    }),
    { name: 'aptmine_watchlist', storage: createJSONStorage(() => AsyncStorage) }
  )
);
```
{% endraw %}
{% endraw %}

**Step 2: 관심목록 화면**

{% raw %}
{% raw %}
```tsx
// app/(tabs)/watchlist.tsx
import { FlatList, View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useWatchlistStore } from '../../lib/watchlist';

export default function WatchlistScreen() {
  const { items, remove } = useWatchlistStore();

  if (!items.length) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 items-center justify-center">
        <Text className="text-4xl mb-4">⭐</Text>
        <Text className="text-base font-bold text-slate-700">관심 단지가 없습니다</Text>
        <Text className="text-sm text-slate-400 mt-1">아파트 상세에서 추가해보세요</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-2xl font-black text-slate-900">관심 목록</Text>
        <Text className="text-xs text-slate-400">{items.length}개</Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push(`/apt/${item.id}`)}
            className="bg-white border-b border-slate-100 px-4 py-3 flex-row items-center justify-between"
          >
            <View>
              <Text className="text-sm font-bold text-slate-900">{item.name}</Text>
              <Text className="text-xs text-slate-500">{item.sido} {item.district}</Text>
            </View>
            <TouchableOpacity onPress={() => remove(item.id)} className="p-2">
              <Text className="text-slate-400 text-lg">✕</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}
```
{% endraw %}
{% endraw %}

**Step 3: 아파트 상세에 찜 버튼 추가**

app/apt/[id].tsx의 Card 헤더에 추가:
{% raw %}
{% raw %}
```tsx
const { add, remove, has } = useWatchlistStore();
const isWatched = has(id!);

// 헤더 우측에 버튼 추가
<TouchableOpacity onPress={() => isWatched ? remove(id!) : add({ id: id!, name: data?.name, sido: data?.sido, district: data?.district })}>
  <Text className="text-2xl">{isWatched ? '⭐' : '☆'}</Text>
</TouchableOpacity>
```
{% endraw %}
{% endraw %}

**Step 4: 실행 확인** — 찜 추가/삭제, 관심목록 탭에서 확인

**Step 5: 커밋**

{% raw %}
{% raw %}
```bash
git add . && git commit -m "feat: 관심목록 (로컬 AsyncStorage)"
```
{% endraw %}
{% endraw %}

---

## Phase 4: Supabase 인증

### Task 11: Supabase 설정 + 구글 로그인

**Files:**
- Create: `lib/supabase.ts`
- Create: `app/auth.tsx`

**Step 1: Supabase 프로젝트 생성**

1. https://supabase.com 에서 새 프로젝트 생성
2. Settings → API에서 URL과 anon key 복사
3. `.env` 파일 생성 (gitignore에 추가):

{% raw %}
{% raw %}
```
EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJxxx
```
{% endraw %}
{% endraw %}

**Step 2: lib/supabase.ts**

{% raw %}
{% raw %}
```ts
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { storage: ExpoSecureStoreAdapter, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } }
);
```
{% endraw %}
{% endraw %}

**Step 3: Supabase Google OAuth 설정**

1. Supabase Dashboard → Authentication → Providers → Google 활성화
2. Google Cloud Console에서 OAuth 클라이언트 ID 생성 (Android + iOS)
3. Supabase에 Client ID/Secret 입력
4. Redirect URL: `aptmine://auth/callback` 설정

**Step 4: auth.tsx**

{% raw %}
{% raw %}
```tsx
// app/auth.tsx
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../lib/supabase';
import { router } from 'expo-router';
import { useState } from 'react';

WebBrowser.maybeCompleteAuthSession();

const redirectTo = makeRedirectUri({ scheme: 'aptmine', path: 'auth/callback' });

export default function AuthScreen() {
  const [loading, setLoading] = useState<string | null>(null);

  const signInWithGoogle = async () => {
    setLoading('google');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (data?.url) {
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success') {
        const url = new URL(result.url);
        const code = url.searchParams.get('code');
        if (code) await supabase.auth.exchangeCodeForSession(code);
        router.back();
      }
    }
    setLoading(null);
  };

  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center p-6">
      <Text className="text-3xl mb-2">🏠</Text>
      <Text className="text-2xl font-black text-slate-900 mb-1">APT Mine</Text>
      <Text className="text-sm text-slate-500 mb-10">관심 단지와 알림을 관리하세요</Text>

      <TouchableOpacity
        onPress={signInWithGoogle}
        disabled={!!loading}
        className="w-full bg-white border border-slate-200 rounded-2xl py-4 flex-row items-center justify-center mb-3 shadow-sm"
      >
        {loading === 'google' ? <ActivityIndicator size="small" color="#2563eb" /> : (
          <Text className="text-base font-bold text-slate-700">Google로 시작하기</Text>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}
```
{% endraw %}
{% endraw %}

**Step 5: 실행 확인** — 구글 로그인 → 콜백 처리 → 로그인 성공

**Step 6: 커밋**

{% raw %}
{% raw %}
```bash
git add . && git commit -m "feat: Supabase + 구글 로그인"
```
{% endraw %}
{% endraw %}

---

### Task 12: 카카오 + 네이버 로그인

**Step 1: 카카오 로그인 설정**

1. https://developers.kakao.com 에서 앱 생성
2. 플랫폼 등록 (Android 패키지명, iOS 번들 ID)
3. Kakao SDK 설치: `npm install @react-native-kakao/core @react-native-kakao/user`
4. app.json에 Kakao 플러그인 추가

{% raw %}
{% raw %}
```json
"plugins": [
  ["@react-native-kakao/core", { "nativeAppKey": "YOUR_KAKAO_KEY" }]
]
```
{% endraw %}
{% endraw %}

**Step 2: 카카오 로그인 구현 (auth.tsx에 추가)**

{% raw %}
{% raw %}
```ts
import { login as kakaoLogin } from '@react-native-kakao/user';

const signInWithKakao = async () => {
  setLoading('kakao');
  try {
    const token = await kakaoLogin();
    // Kakao 토큰으로 Supabase custom token 교환 (Edge Function 필요)
    const { data, error } = await supabase.functions.invoke('auth-kakao', {
      body: { access_token: token.accessToken },
    });
    if (data?.supabase_token) {
      await supabase.auth.setSession(data.supabase_token);
      router.back();
    }
  } catch (e) { console.error(e); }
  setLoading(null);
};
```
{% endraw %}
{% endraw %}

**Step 3: 네이버 로그인 설정**

1. https://developers.naver.com 에서 앱 등록
2. `npm install @react-native-naver-login/naver-login` 설치
3. 카카오와 동일 패턴으로 Supabase Edge Function 경유

**Step 4: Supabase Edge Function: auth-kakao**

{% raw %}
{% raw %}
```ts
// supabase/functions/auth-kakao/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const { access_token } = await req.json();

  // 카카오 API로 유저 정보 조회
  const kakaoRes = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const kakaoUser = await kakaoRes.json();

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // upsert user
  const { data } = await supabase.auth.admin.createUser({
    email: kakaoUser.kakao_account?.email ?? `kakao_${kakaoUser.id}@aptmine.com`,
    email_confirm: true,
    user_metadata: { name: kakaoUser.properties?.nickname, provider: 'kakao' },
  });

  const { data: session } = await supabase.auth.admin.createSession({ user_id: data.user!.id });

  return new Response(JSON.stringify({ supabase_token: session }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```
{% endraw %}
{% endraw %}

**Step 5: 배포**

{% raw %}
{% raw %}
```bash
npx supabase functions deploy auth-kakao
```
{% endraw %}
{% endraw %}

**Step 6: 실행 확인**

**Step 7: 커밋**

{% raw %}
{% raw %}
```bash
git add . && git commit -m "feat: 카카오/네이버 로그인"
```
{% endraw %}
{% endraw %}

---

## Phase 5: 관심목록 동기화 + 알림

### Task 13: Supabase 관심목록 동기화

**Files:**
- Create: `supabase/migrations/001_watchlist.sql`
- Modify: `lib/watchlist.ts`

**Step 1: DB 마이그레이션**

{% raw %}
{% raw %}
```sql
-- supabase/migrations/001_watchlist.sql
create table watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  apt_id text not null,
  apt_name text not null,
  sido text not null,
  district text not null,
  created_at timestamptz default now(),
  unique(user_id, apt_id)
);
alter table watchlist enable row level security;
create policy "users can manage own watchlist" on watchlist
  for all using (auth.uid() = user_id);

create table notification_settings (
  user_id uuid primary key references auth.users on delete cascade,
  newhigh_enabled boolean default true,
  undervalued_enabled boolean default true
);
alter table notification_settings enable row level security;
create policy "users can manage own settings" on notification_settings
  for all using (auth.uid() = user_id);

create table notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  apt_id text not null,
  type text check (type in ('newhigh', 'undervalued')),
  sent_at timestamptz default now()
);
```
{% endraw %}
{% endraw %}

**Step 2: 마이그레이션 실행**

{% raw %}
{% raw %}
```bash
npx supabase db push
```
{% endraw %}
{% endraw %}

**Step 3: 관심목록 스토어 수정 (로그인 시 Supabase 동기화)**

`lib/watchlist.ts`에 syncWithSupabase 함수 추가:
{% raw %}
{% raw %}
```ts
import { supabase } from './supabase';

export async function syncWatchlistToSupabase(userId: string, items: WatchItem[]) {
  await supabase.from('watchlist').upsert(
    items.map(i => ({ user_id: userId, apt_id: i.id, apt_name: i.name, sido: i.sido, district: i.district })),
    { onConflict: 'user_id,apt_id' }
  );
}

export async function loadWatchlistFromSupabase(userId: string): Promise<WatchItem[]> {
  const { data } = await supabase.from('watchlist').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  return (data ?? []).map(d => ({ id: d.apt_id, name: d.apt_name, sido: d.sido, district: d.district, addedAt: d.created_at }));
}
```
{% endraw %}
{% endraw %}

**Step 4: 로그인 후 자동 동기화** — 관심목록 화면에서 로그인 감지 후 Supabase 로드

**Step 5: 커밋**

{% raw %}
{% raw %}
```bash
git add . && git commit -m "feat: 관심목록 Supabase 동기화"
```
{% endraw %}
{% endraw %}

---

### Task 14: 푸시 알림 설정 + Edge Function

**Files:**
- Create: `supabase/functions/notify-watchlist/index.ts`
- Modify: `app/(tabs)/watchlist.tsx` (알림 설정 UI)

**Step 1: Expo Push Token 등록**

앱 시작 시 `lib/notifications.ts`:
{% raw %}
{% raw %}
```ts
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

export async function registerPushToken(userId: string) {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  const token = (await Notifications.getExpoPushTokenAsync()).data;

  await supabase.from('notification_settings')
    .upsert({ user_id: userId, push_token: token, newhigh_enabled: true, undervalued_enabled: true }, { onConflict: 'user_id' });
}
```
{% endraw %}
{% endraw %}

notification_settings 테이블에 `push_token text` 컬럼 추가:
{% raw %}
{% raw %}
```sql
alter table notification_settings add column if not exists push_token text;
```
{% endraw %}
{% endraw %}

**Step 2: Edge Function — 매일 알림 발송**

{% raw %}
{% raw %}
```ts
// supabase/functions/notify-watchlist/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BASE = 'https://aptmine.com/';

serve(async () => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 신고가/저평가 데이터 fetch
  const [newhigh, undervalued] = await Promise.all([
    fetch(`${BASE}data/apt_trade/newhigh_summary.json`).then(r => r.json()),
    fetch(`${BASE}data/apt_trade/undervalued.json`).then(r => r.json()),
  ]);

  const newhighIds = new Set((newhigh?.items ?? []).map((i: any) => i.id));
  const undervaluedIds = new Set((undervalued ?? []).map((i: any) => i.id));

  // 알림 설정된 유저의 관심목록 조회
  const { data: settings } = await supabase
    .from('notification_settings')
    .select('user_id, push_token, newhigh_enabled, undervalued_enabled')
    .not('push_token', 'is', null);

  const messages: any[] = [];

  for (const setting of settings ?? []) {
    const { data: watchlist } = await supabase
      .from('watchlist')
      .select('apt_id, apt_name')
      .eq('user_id', setting.user_id);

    for (const item of watchlist ?? []) {
      if (setting.newhigh_enabled && newhighIds.has(item.apt_id)) {
        // 오늘 이미 발송했는지 확인
        const today = new Date().toISOString().split('T')[0];
        const { count } = await supabase.from('notification_log')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', setting.user_id).eq('apt_id', item.apt_id)
          .eq('type', 'newhigh').gte('sent_at', today);

        if (!count) {
          messages.push({ to: setting.push_token, title: '🚀 신고가 알림', body: `${item.apt_name} 신고가 달성!`, data: { apt_id: item.apt_id } });
          await supabase.from('notification_log').insert({ user_id: setting.user_id, apt_id: item.apt_id, type: 'newhigh' });
        }
      }

      if (setting.undervalued_enabled && undervaluedIds.has(item.apt_id)) {
        messages.push({ to: setting.push_token, title: '💡 저평가 알림', body: `${item.apt_name} 저평가 진입`, data: { apt_id: item.apt_id } });
      }
    }
  }

  // Expo Push API 전송 (100개 배치)
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }

  return new Response(JSON.stringify({ sent: messages.length }), { headers: { 'Content-Type': 'application/json' } });
});
```
{% endraw %}
{% endraw %}

**Step 3: Edge Function 배포 + Cron 설정**

{% raw %}
{% raw %}
```bash
npx supabase functions deploy notify-watchlist
```
{% endraw %}
{% endraw %}

Supabase Dashboard → Database → Cron Jobs:
{% raw %}
{% raw %}
```
Schedule: 0 9 * * *  (매일 오전 9시)
Command: SELECT net.http_post('https://xxx.supabase.co/functions/v1/notify-watchlist', '{}', 'application/json');
```
{% endraw %}
{% endraw %}

**Step 4: 알림 설정 UI (watchlist 화면에 추가)**

{% raw %}
{% raw %}
```tsx
// 알림 토글 UI
const [newhigh, setNewhigh] = useState(true);
const toggleNewhigh = async (value: boolean) => {
  setNewhigh(value);
  await supabase.from('notification_settings').upsert({ user_id: userId, newhigh_enabled: value }, { onConflict: 'user_id' });
};
<Switch value={newhigh} onValueChange={toggleNewhigh} trackColor={{ true: '#2563eb' }} />
```
{% endraw %}
{% endraw %}

**Step 5: 커밋**

{% raw %}
{% raw %}
```bash
git add . && git commit -m "feat: 푸시 알림 + Edge Function"
```
{% endraw %}
{% endraw %}

---

## Phase 6: 배포 준비

### Task 15: EAS Build + 스토어 제출

**Step 1: EAS 설정**

{% raw %}
{% raw %}
```bash
npm install -g eas-cli
eas login
eas build:configure
```
{% endraw %}
{% endraw %}

eas.json 생성:
{% raw %}
{% raw %}
```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": { "distribution": "internal" },
    "production": {}
  },
  "submit": {
    "production": {
      "android": { "serviceAccountKeyPath": "./google-play-key.json", "track": "internal" },
      "ios": { "appleId": "your@email.com", "ascAppId": "YOUR_APP_ID", "appleTeamId": "TEAM_ID" }
    }
  }
}
```
{% endraw %}
{% endraw %}

**Step 2: 앱 아이콘 + 스플래시 준비**

- `assets/icon.png` — 1024×1024 (APT Mine 로고)
- `assets/splash.png` — 1284×2778 (어두운 배경 + 로고)
- `assets/adaptive-icon.png` — 1024×1024 (Android 어댑티브)

**Step 3: Android 빌드**

{% raw %}
{% raw %}
```bash
eas build --platform android --profile production
```
{% endraw %}
{% endraw %}

**Step 4: iOS 빌드**

{% raw %}
{% raw %}
```bash
eas build --platform ios --profile production
```
{% endraw %}
{% endraw %}

**Step 5: 스토어 제출**

{% raw %}
{% raw %}
```bash
# Google Play
eas submit --platform android

# App Store
eas submit --platform ios
```
{% endraw %}
{% endraw %}

**Step 6: 스토어 메타데이터 준비**
- 앱 이름: APT Mine - 아파트 실거래가
- 카테고리: 재정
- 설명: 국토교통부 실거래가 기반 아파트 시세 조회 및 저평가 단지 탐색
- 스크린샷: 홈, 검색, 아파트 상세, 관심목록 (iOS 6.5인치, Android)

**Step 7: 최종 커밋**

{% raw %}
{% raw %}
```bash
git add . && git commit -m "chore: EAS Build 설정 + 스토어 제출 준비"
```
{% endraw %}
{% endraw %}

---

## 주요 체크리스트

- [ ] summary.json 실제 필드명으로 홈/시세 화면 조정
- [ ] by_apt JSON 실제 필드명으로 상세 화면 조정
- [ ] 카카오 개발자 앱 등록 + SDK 키 설정
- [ ] 네이버 개발자 앱 등록 + SDK 키 설정
- [ ] Google Play 개발자 계정 (등록비 $25 일회성)
- [ ] App Store Connect 계정 (연 $99)
- [ ] Supabase 프로젝트 URL + anon key 환경변수 설정
