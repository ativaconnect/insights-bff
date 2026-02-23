# Deploy AWS via GitHub Actions (insights-bff)

## 1) Secrets no repositório `insights-bff`

Configure estes secrets em `Settings > Secrets and variables > Actions`:

- `AWS_ROLE_TO_ASSUME`: ARN da role assumida pelo GitHub Actions.
- `JWT_SECRET_PET`
- `JWT_SECRET_DEV`
- `JWT_SECRET_PRD`

## 2) Trust policy da role (OIDC GitHub)

Use a trust policy abaixo na role indicada em `AWS_ROLE_TO_ASSUME`, ajustando `ACCOUNT_ID`, `ORG` e `REPO`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:ativaconnect/insights-bff:*"
        }
      }
    }
  ]
}
```

## 3) Permissoes da role para deploy Serverless

Permissoes minimas recomendadas:

- CloudFormation: `CreateStack`, `UpdateStack`, `DeleteStack`, `Describe*`, `List*`, `GetTemplate`, `ValidateTemplate`
- Lambda: `CreateFunction`, `UpdateFunctionCode`, `UpdateFunctionConfiguration`, `DeleteFunction`, `TagResource`, `UntagResource`, `List*`, `Get*`
- API Gateway v2: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`
- IAM: `PassRole`, `CreateRole`, `DeleteRole`, `AttachRolePolicy`, `DetachRolePolicy`, `PutRolePolicy`, `DeleteRolePolicy`, `GetRole`
- CloudWatch Logs: `CreateLogGroup`, `CreateLogStream`, `PutLogEvents`, `PutRetentionPolicy`, `DescribeLogGroups`
- DynamoDB: `CreateTable`, `UpdateTable`, `DeleteTable`, `DescribeTable`, `TagResource`, `UntagResource`
- S3 (bucket de deploy do Serverless): `CreateBucket`, `PutObject`, `GetObject`, `DeleteObject`, `ListBucket`

## 4) Executar deploy

1. Abra `Actions > Deploy BFF`.
2. Clique em `Run workflow`.
3. Escolha `stage` (`pet`, `dev` ou `prd`) e `aws_region`.
4. O workflow executa `serverless deploy` e cria/atualiza:
   - Lambdas e API HTTP;
   - tabelas DynamoDB;
   - logs CloudWatch com retention de 30 dias.
