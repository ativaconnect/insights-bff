import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const RegisterRequestSchema = z.object({
  personType: z.enum(['PF', 'PJ']),
  document: z.string(),
  legalName: z.string(),
  tradeName: z.string().optional(),
  email: z.string(),
  phone: z.string(),
  password: z.string().min(6),
  captchaToken: z.string().optional(),
  address: z.object({
    cep: z.string(),
    state: z.string(),
    city: z.string(),
    neighborhood: z.string(),
    street: z.string(),
    number: z.string(),
    complement: z.string().optional()
  })
});

export const LoginRequestSchema = z.object({
  email: z.string(),
  password: z.string(),
  captchaToken: z.string().optional()
});

export const CreateInterviewerRequestSchema = z.object({
  name: z.string().min(1),
  login: z.string().min(1),
  password: z.string().min(6),
  phone: z.string().optional(),
  email: z.string().optional()
});

export const UpdateInterviewerRequestSchema = z.object({
  name: z.string().optional(),
  login: z.string().optional(),
  password: z.string().min(6).optional(),
  phone: z.string().optional(),
  email: z.string().optional()
});

export const SetInterviewerStatusRequestSchema = z.object({
  status: z.enum(['active', 'inactive'])
});

export const CreateSurveyRequestSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    status: z.enum(['draft', 'active', 'archived']).optional(),
    audience: z.enum(['B2B', 'B2C', 'Mixed']).optional(),
    questions: z.array(z.record(z.string(), z.unknown())).optional(),
    quotaRules: z.array(z.record(z.string(), z.unknown())).optional(),
    interviewerAssignments: z.array(z.record(z.string(), z.unknown())).optional(),
    waves: z.array(z.record(z.string(), z.unknown())).optional(),
    locationCapture: z.record(z.string(), z.unknown()).optional(),
    kioskSettings: z.record(z.string(), z.unknown()).optional()
  })
  .catchall(z.unknown());

export const SubmitSurveyResponseRequestSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()).optional(),
  clientResponseId: z.string().optional(),
  submittedAt: z.string().datetime().optional(),
  interviewerId: z.string().optional(),
  deviceId: z.string().optional(),
  location: z
    .object({
      lat: z.number(),
      lng: z.number(),
      accuracyMeters: z.number().optional()
    })
    .optional()
});

export const SubmitSurveyResponsesBatchRequestSchema = z.object({
  responses: z.array(SubmitSurveyResponseRequestSchema).min(1)
});

export const CreditPurchaseRequestInputSchema = z.object({
  productCode: z.string().optional(),
  planCode: z.string().min(1),
  credits: z.number().int().positive(),
  paymentMethod: z.enum(['PIX', 'CREDIT_CARD']).optional(),
  note: z.string().optional()
});

export type RegisterRequestDto = z.infer<typeof RegisterRequestSchema>;
export type LoginRequestDto = z.infer<typeof LoginRequestSchema>;
export type CreateInterviewerRequestDto = z.infer<typeof CreateInterviewerRequestSchema>;
export type UpdateInterviewerRequestDto = z.infer<typeof UpdateInterviewerRequestSchema>;
export type SetInterviewerStatusRequestDto = z.infer<typeof SetInterviewerStatusRequestSchema>;
export type CreateSurveyRequestDto = z.infer<typeof CreateSurveyRequestSchema>;
export type SubmitSurveyResponseRequestDto = z.infer<typeof SubmitSurveyResponseRequestSchema>;
export type SubmitSurveyResponsesBatchRequestDto = z.infer<typeof SubmitSurveyResponsesBatchRequestSchema>;
export type CreditPurchaseRequestInputDto = z.infer<typeof CreditPurchaseRequestInputSchema>;
