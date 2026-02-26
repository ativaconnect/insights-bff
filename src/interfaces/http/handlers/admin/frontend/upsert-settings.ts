import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { withLoggedHandler } from '../../../logged-handler';
import { FrontendSettingsRepository } from '../../../../../infrastructure/persistence/dynamodb/frontend-settings.repository';
import { normalizeProductCode } from '../../../../../shared/products';
import { authorize, isAuthorizationError } from '../../../middleware/auth.middleware';
import { parseBody } from '../../../request';
import { fail, ok } from '../../../response';

interface UpsertFrontendSettingsBody {
  productCode?: string;
  hero?: {
    headerLabel?: string;
    heroBadge?: string;
    headline?: string;
    subheadline?: string;
    primaryCtaLabel?: string;
    secondaryCtaLabel?: string;
    dynamicTitle?: string;
    dynamicCopy?: string;
    resourcesTitle?: string;
    resourcesTags?: string[];
  };
  sections?: {
    showSocialProof?: boolean;
    showPricing?: boolean;
    showProof?: boolean;
    showBenefits?: boolean;
    showFaq?: boolean;
  };
  layout?: {
    sectionOrder?: Array<'socialProof' | 'pricing' | 'proof' | 'benefits' | 'faq'>;
  };
  content?: {
    socialProof?: {
      title?: string;
      logos?: string[];
    };
    pricing?: {
      eyebrow?: string;
      title?: string;
      emptyMessage?: string;
    };
    proof?: {
      items?: Array<{ metric?: string; label?: string }>;
    };
    benefits?: {
      eyebrow?: string;
      title?: string;
      items?: Array<{ title?: string; copy?: string; span?: string }>;
    };
    faq?: {
      eyebrow?: string;
      title?: string;
      items?: Array<{ pill?: string; title?: string; answer?: string }>;
    };
  };
}

const repository = new FrontendSettingsRepository();

const rawHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = authorize(event, 'ROLE_ADMIN');
  if (isAuthorizationError(auth)) {
    return auth;
  }

  try {
    const body = parseBody<UpsertFrontendSettingsBody>(event);
    const productCode = normalizeProductCode(body.productCode);
    const updated = await repository.upsert(productCode, auth.subject, {
      hero: body.hero,
      sections: body.sections,
      layout: body.layout,
      content: body.content
    });
    return ok(updated);
  } catch {
    return fail(400, 'Nao foi possivel salvar configuracao de frontend.');
  }
};

export const handler = withLoggedHandler('admin/frontend/upsert-settings', rawHandler);


