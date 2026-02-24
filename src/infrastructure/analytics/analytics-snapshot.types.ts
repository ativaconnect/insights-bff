export interface SurveyAnalyticsSnapshot {
  version: string;
  tenantId: string;
  surveyId: string;
  responsesCount: number;
  sourceUpdatedAt: string;
  generatedAt: string;
  heatmap: Array<{ lat: number; lng: number; count: number }>;
}

