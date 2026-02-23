const sanitize = (value: string): string => value.trim().toLowerCase();
const onlyDigits = (value: string): string => value.replace(/\D/g, '');

export const keys = {
  client: (clientId: string) => ({
    PK: `CLIENT#${clientId}`,
    SK: 'PROFILE'
  }),
  clientDocumentLock: (document: string) => ({
    PK: `CLIENTDOC#${onlyDigits(document)}`,
    SK: 'LOCK'
  }),
  user: (userId: string) => ({
    PK: `USER#${userId}`,
    SK: 'PROFILE'
  }),
  interviewer: (tenantId: string, interviewerId: string) => ({
    PK: `TENANT#${tenantId}`,
    SK: `INTERVIEWER#${interviewerId}`
  }),
  gsi1UserByEmail: (email: string) => ({
    GSI1PK: `USEREMAIL#${sanitize(email)}`,
    GSI1SK: 'PROFILE'
  }),
  gsi1ClientByDocument: (document: string) => ({
    GSI1PK: `CLIENTDOC#${onlyDigits(document)}`,
    GSI1SK: 'PROFILE'
  }),
  gsi2UserByRole: (role: string, createdAt: string, userId: string) => ({
    GSI2PK: `ROLE#${role}`,
    GSI2SK: `${createdAt}#${userId}`
  }),
  gsi2InterviewerByTenant: (tenantId: string, createdAt: string, interviewerId: string) => ({
    GSI2PK: `TENANT#${tenantId}#INTERVIEWER`,
    GSI2SK: `${createdAt}#${interviewerId}`
  }),
  gsi2ClientList: (createdAt: string, clientId: string) => ({
    GSI2PK: 'ENTITY#CLIENT',
    GSI2SK: `${createdAt}#${clientId}`
  })
};

export const normalizeEmail = sanitize;
export const normalizeDigits = onlyDigits;
