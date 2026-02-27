aptmine.com의 GA4 유입 데이터를 분석한다.

## 인자
- $ARGUMENTS: 분석 기간 (예: "오늘", "어제", "이번주", "최근7일", "실시간")
- 기본값: "오늘"

## GA4 설정
- Property ID: 524708418
- GCP 프로젝트: bubbly-domain-481501-k6
- 인증: gcloud application-default credentials (analytics.readonly 스코프 필요)
- 토큰: `gcloud auth application-default print-access-token`
- 리포트 API: `https://analyticsdata.googleapis.com/v1beta/properties/524708418:runReport`
- 실시간 API: `https://analyticsdata.googleapis.com/v1beta/properties/524708418:runRealtimeReport`
- 요청 헤더: `x-goog-user-project: bubbly-domain-481501-k6`

## 기간 매핑
- "실시간" → runRealtimeReport API 사용 (아래 실시간 리포트 섹션 참조)
- "오늘" → startDate: "today", endDate: "today", 비교: "yesterday"
- "어제" → startDate: "yesterday", endDate: "yesterday", 비교: "2daysAgo"
- "이번주" → startDate: 이번주 월요일, endDate: "today", 비교: 지난주 동일 기간
- "최근7일" → startDate: "7daysAgo", endDate: "today", 비교: "14daysAgo"~"8daysAgo"

## 조회할 리포트 (3개 병렬 호출)

### 1. 채널별 유입
- dimensions: sessionDefaultChannelGroup
- metrics: sessions, totalUsers, screenPageViews, averageSessionDuration, bounceRate
- orderBys: sessions DESC

### 2. 인기 페이지
- dimensions: pagePath
- metrics: screenPageViews, totalUsers
- orderBys: screenPageViews DESC
- limit: 15

### 3. 오늘 vs 비교기간
- dateRanges: [현재기간, 비교기간]
- metrics: sessions, totalUsers, screenPageViews, newUsers

### 4. 시간대별 (오늘/어제만)
- dimensions: hour
- metrics: sessions, totalUsers
- orderBys: hour ASC

## 실시간 리포트 ("실시간" 선택 시, 4개 병렬 호출)
runRealtimeReport API 사용. dateRanges 없음 (최근 30분 자동).

### R1. 전체 활성 사용자
- metrics: activeUsers, screenPageViews

### R2. 페이지별 활성 사용자
- dimensions: unifiedScreenName
- metrics: activeUsers
- orderBys: activeUsers DESC

### R3. 기기별 활성 사용자
- dimensions: deviceCategory
- metrics: activeUsers

### R4. 도시별 활성 사용자
- dimensions: city
- metrics: activeUsers
- orderBys: activeUsers DESC
- limit: 10

## 실시간 출력 형식
마크다운 테이블로 정리:
1. 활성 사용자 수 + 총 PV (큰 숫자로 강조)
2. 페이지별 활성 사용자 테이블 (페이지명 매핑 적용, unifiedScreenName에서 " - APT Mine" 제거 후 매칭)
3. 기기별 비율 테이블
4. 접속 도시 테이블
5. 주요 포인트 1~3줄

## 페이지 타이틀 매핑 (실시간용, unifiedScreenName → 표시명)
- "아파트 시세 비교 · 저평가 분석" → 메인
- "아파트 실거래가 조회 · 매매 시세 분석" → 단지분석
- "저평가 아파트 추천 TOP3 · 아파트 투자 분석" → 저평가 TOP3
- "아파트 시세 조회 · 지역별 부동산 시세 추이" → 지역시세
- "아파트 실거래가 검색 · 단지별 시세 비교" → 비교검색
- "아파트 전세 실거래가 · 전세가율 조회" → 전세시세
- "바닥 근처 아파트 찾기 · 전고점 대비 하락 단지" → 바닥찾기
- "저평가 백테스트 · 아파트 투자 분석 검증" → 백테스트
- "관심목록" → 관심목록

## 출력 형식 (기간 분석용)
마크다운 테이블로 정리:
1. 전체 요약 (오늘 vs 비교기간, 변화율 포함)
2. 유입 채널 테이블 (세션, 사용자, PV, 평균체류시간)
3. 인기 페이지 테이블 (PV, 사용자)
4. 시간대별 세션 막대그래프 (텍스트 █ 로 표현)
5. 주요 포인트 요약 (3~5줄)

## 체류시간 변환
- API 응답은 초 단위 → "X분Y초" 형식으로 변환

## 페이지명 매핑
- / 또는 /index.html → 메인
- /search.html → 비교검색
- /undervalued.html → 저평가 TOP3
- /valuation.html → 단지분석
- /regional.html → 지역시세
- /jeonse.html → 전세시세
- /bottom.html → 바닥찾기
- /backtest.html → 백테스트
- /watchlist.html → 관심목록
