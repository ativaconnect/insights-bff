import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { plansTableName, dynamoDbDocumentClient } from './dynamo-client';
import { DEFAULT_PRODUCT_CODE, normalizeProductCode } from '../../../shared/products';

const FRONTEND_SETTINGS_SK = 'FRONTEND_SETTINGS';
const SECTION_IDS = ['socialProof', 'pricing', 'proof', 'benefits', 'faq'] as const;
type FrontendSectionId = (typeof SECTION_IDS)[number];

interface FrontendHeroSettings {
  headerLabel: string;
  heroBadge: string;
  headline?: string;
  subheadline?: string;
  primaryCtaLabel: string;
  secondaryCtaLabel: string;
  dynamicTitle?: string;
  dynamicCopy?: string;
  resourcesTitle?: string;
  resourcesTags: string[];
}

interface FrontendVisibilitySettings {
  showSocialProof: boolean;
  showPricing: boolean;
  showProof: boolean;
  showBenefits: boolean;
  showFaq: boolean;
}

interface FrontendLayoutSettings {
  sectionOrder: FrontendSectionId[];
}

interface FrontendContentSettings {
  socialProof: {
    title: string;
    logos: string[];
  };
  pricing: {
    eyebrow: string;
    title: string;
    emptyMessage: string;
  };
  proof: {
    items: Array<{ metric: string; label: string }>;
  };
  benefits: {
    eyebrow: string;
    title: string;
    items: Array<{ title: string; copy: string; span?: string }>;
  };
  faq: {
    eyebrow: string;
    title: string;
    items: Array<{ pill: string; title: string; answer: string }>;
  };
}

interface FrontendSettingsRecord {
  PK: string;
  SK: typeof FRONTEND_SETTINGS_SK;
  GSI2PK: 'ENTITY#FRONTEND_SETTINGS';
  GSI2SK: string;
  entityType: 'FRONTEND_SETTINGS';
  productCode: string;
  hero: FrontendHeroSettings;
  sections: FrontendVisibilitySettings;
  layout: FrontendLayoutSettings;
  content: FrontendContentSettings;
  logos?: string[];
  updatedAt: string;
  updatedBy: string;
  createdAt: string;
}

export interface FrontendSettings {
  productCode: string;
  hero: FrontendHeroSettings;
  sections: FrontendVisibilitySettings;
  layout: FrontendLayoutSettings;
  content: FrontendContentSettings;
  updatedAt: string;
  updatedBy: string;
  createdAt: string;
}

const clampText = (value: unknown, max: number, fallback: string): string => {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, max);
};

const clampOptionalText = (value: unknown, max: number): string | undefined => {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? normalized.slice(0, max) : undefined;
};

const toBoolean = (value: unknown, fallback: boolean): boolean => {
  return typeof value === 'boolean' ? value : fallback;
};

const normalizeStringList = (value: unknown, fallback: string[], max = 12, itemLimit = 90): string[] => {
  const input = Array.isArray(value) ? value : [];
  const unique = new Set<string>();
  for (const item of input) {
    const normalized = String(item ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, itemLimit);
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
    if (unique.size >= max) {
      break;
    }
  }
  const output = Array.from(unique.values());
  return output.length ? output : fallback;
};

const normalizeProofItems = (
  value: unknown,
  fallback: Array<{ metric: string; label: string }>
): Array<{ metric: string; label: string }> => {
  const input = Array.isArray(value) ? value : [];
  const output: Array<{ metric: string; label: string }> = [];
  for (const item of input) {
    const record = item as { metric?: unknown; label?: unknown };
    const metric = clampText(record.metric, 20, '');
    const label = clampText(record.label, 80, '');
    if (!metric || !label) {
      continue;
    }
    output.push({ metric, label });
    if (output.length >= 8) {
      break;
    }
  }
  return output.length ? output : fallback;
};

const normalizeBenefitItems = (
  value: unknown,
  fallback: Array<{ title: string; copy: string; span?: string }>
): Array<{ title: string; copy: string; span?: string }> => {
  const input = Array.isArray(value) ? value : [];
  const output: Array<{ title: string; copy: string; span?: string }> = [];
  for (const item of input) {
    const record = item as { title?: unknown; copy?: unknown; span?: unknown };
    const title = clampText(record.title, 120, '');
    const copy = clampText(record.copy, 420, '');
    const span = clampOptionalText(record.span, 40);
    if (!title || !copy) {
      continue;
    }
    output.push({ title, copy, span });
    if (output.length >= 8) {
      break;
    }
  }
  return output.length ? output : fallback;
};

const normalizeFaqItems = (
  value: unknown,
  fallback: Array<{ pill: string; title: string; answer: string }>
): Array<{ pill: string; title: string; answer: string }> => {
  const input = Array.isArray(value) ? value : [];
  const output: Array<{ pill: string; title: string; answer: string }> = [];
  for (const item of input) {
    const record = item as { pill?: unknown; title?: unknown; answer?: unknown };
    const pill = clampText(record.pill, 40, '');
    const title = clampText(record.title, 160, '');
    const answer = clampText(record.answer, 420, '');
    if (!pill || !title || !answer) {
      continue;
    }
    output.push({ pill, title, answer });
    if (output.length >= 12) {
      break;
    }
  }
  return output.length ? output : fallback;
};

const normalizeSectionOrder = (value: unknown, fallback: FrontendSectionId[]): FrontendSectionId[] => {
  const input = Array.isArray(value) ? value : [];
  const selected: FrontendSectionId[] = [];
  for (const raw of input) {
    const item = String(raw ?? '').trim() as FrontendSectionId;
    if (!SECTION_IDS.includes(item) || selected.includes(item)) {
      continue;
    }
    selected.push(item);
  }
  const base = selected.length ? selected : fallback;
  const completed = [...base];
  for (const id of SECTION_IDS) {
    if (!completed.includes(id)) {
      completed.push(id);
    }
  }
  return completed;
};

const buildDefaultSettings = (productCode: string): FrontendSettings => {
  const now = new Date(0).toISOString();
  return {
    productCode,
    hero: {
      headerLabel: 'Customer Intelligence',
      heroBadge: 'Plataforma de pesquisa para clientes',
      primaryCtaLabel: 'Comecar gratis',
      secondaryCtaLabel: 'Ver demonstracao',
      resourcesTags: ['Dashboards', 'Automacoes', 'Insights', 'Alertas']
    },
    sections: {
      showSocialProof: true,
      showPricing: true,
      showProof: true,
      showBenefits: true,
      showFaq: true
    },
    layout: {
      sectionOrder: [...SECTION_IDS]
    },
    content: {
      socialProof: {
        title: 'Empresas que confiam na Ativa',
        logos: ['Grupo Atlas', 'Nova Varejo', 'Pulse CX', 'Clara Energia', 'Orbit Saude', 'Mira Educacao']
      },
      pricing: {
        eyebrow: 'Precos',
        title: 'Planos prontos para escalar',
        emptyMessage: 'Nenhum plano publicado no momento.'
      },
      proof: {
        items: [
          { metric: '+28%', label: 'Aumento de respostas validadas' },
          { metric: '-43%', label: 'Reducao de retrabalho operacional' },
          { metric: '4.7/5', label: 'Satisfacao media dos times de campo' }
        ]
      },
      benefits: {
        eyebrow: 'Beneficios',
        title: 'Operacao completa, da coleta ao insight',
        items: [
          {
            title: 'Coleta digital com rastreio',
            copy: 'Controle de entrevistadores, localizacao e auditoria para elevar a confiabilidade dos dados.',
            span: 'col-span-12 md:col-span-7'
          },
          {
            title: 'Painel em tempo real',
            copy: 'Acompanhe indicadores de campo e resultados por pesquisa sem esperar consolidacoes manuais.',
            span: 'col-span-12 md:col-span-5'
          },
          {
            title: 'Crescimento com governanca',
            copy: 'Permissoes, trilha de auditoria e configuracoes centralizadas para escalar com seguranca.',
            span: 'col-span-12'
          }
        ]
      },
      faq: {
        eyebrow: 'Perguntas frequentes',
        title: 'Duvidas comuns antes de contratar',
        items: [
          {
            pill: 'Implantacao',
            title: 'Quanto tempo para comecar a operar?',
            answer: 'A configuracao inicial pode ser feita em poucas horas, com suporte do time de implantacao.'
          },
          {
            pill: 'Operacao',
            title: 'Funciona para operacoes de campo e online?',
            answer: 'Sim. A plataforma suporta coleta presencial, remota e hibrida com consolidacao unica.'
          },
          {
            pill: 'Seguranca',
            title: 'Como os dados ficam protegidos?',
            answer: 'O sistema aplica autenticacao, segregacao por tenant e trilha de auditoria administrativa.'
          }
        ]
      }
    },
    updatedAt: now,
    updatedBy: 'system',
    createdAt: now
  };
};

const settingsKey = (productCode: string): { PK: string; SK: typeof FRONTEND_SETTINGS_SK } => ({
  PK: `PRODUCT#${normalizeProductCode(productCode)}`,
  SK: FRONTEND_SETTINGS_SK
});

export class FrontendSettingsRepository {
  async get(productCode: string = DEFAULT_PRODUCT_CODE): Promise<FrontendSettings | null> {
    const normalizedProduct = normalizeProductCode(productCode);
    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: plansTableName,
        Key: settingsKey(normalizedProduct)
      })
    );
    const item = output.Item as FrontendSettingsRecord | undefined;
    return item ? this.mapRecord(item) : null;
  }

  async getOrDefault(productCode: string = DEFAULT_PRODUCT_CODE): Promise<FrontendSettings> {
    const normalizedProduct = normalizeProductCode(productCode);
    const current = await this.get(normalizedProduct);
    return current ?? buildDefaultSettings(normalizedProduct);
  }

  async upsert(
    productCode: string,
    actorUserId: string,
    input: Partial<{
      hero: Partial<FrontendHeroSettings>;
      sections: Partial<FrontendVisibilitySettings>;
      layout: Partial<FrontendLayoutSettings>;
      content: {
        socialProof?: Partial<FrontendContentSettings['socialProof']>;
        pricing?: Partial<FrontendContentSettings['pricing']>;
        proof?: {
          items?: Array<Partial<FrontendContentSettings['proof']['items'][number]>>;
        };
        benefits?: {
          eyebrow?: string;
          title?: string;
          items?: Array<Partial<FrontendContentSettings['benefits']['items'][number]>>;
        };
        faq?: {
          eyebrow?: string;
          title?: string;
          items?: Array<Partial<FrontendContentSettings['faq']['items'][number]>>;
        };
      };
    }>
  ): Promise<FrontendSettings> {
    const normalizedProduct = normalizeProductCode(productCode);
    const current = await this.getOrDefault(normalizedProduct);
    const now = new Date().toISOString();

    const next: FrontendSettingsRecord = {
      ...settingsKey(normalizedProduct),
      GSI2PK: 'ENTITY#FRONTEND_SETTINGS',
      GSI2SK: `${normalizedProduct}#FRONTEND_SETTINGS`,
      entityType: 'FRONTEND_SETTINGS',
      productCode: normalizedProduct,
      hero: {
        headerLabel: clampText(input.hero?.headerLabel, 60, current.hero.headerLabel),
        heroBadge: clampText(input.hero?.heroBadge, 120, current.hero.heroBadge),
        headline: clampOptionalText(input.hero?.headline, 180) ?? current.hero.headline,
        subheadline: clampOptionalText(input.hero?.subheadline, 320) ?? current.hero.subheadline,
        primaryCtaLabel: clampText(input.hero?.primaryCtaLabel, 48, current.hero.primaryCtaLabel),
        secondaryCtaLabel: clampText(input.hero?.secondaryCtaLabel, 48, current.hero.secondaryCtaLabel),
        dynamicTitle: clampOptionalText(input.hero?.dynamicTitle, 120) ?? current.hero.dynamicTitle,
        dynamicCopy: clampOptionalText(input.hero?.dynamicCopy, 240) ?? current.hero.dynamicCopy,
        resourcesTitle: clampOptionalText(input.hero?.resourcesTitle, 90) ?? current.hero.resourcesTitle,
        resourcesTags: normalizeStringList(input.hero?.resourcesTags, current.hero.resourcesTags, 8, 40)
      },
      sections: {
        showSocialProof: toBoolean(input.sections?.showSocialProof, current.sections.showSocialProof),
        showPricing: toBoolean(input.sections?.showPricing, current.sections.showPricing),
        showProof: toBoolean(input.sections?.showProof, current.sections.showProof),
        showBenefits: toBoolean(input.sections?.showBenefits, current.sections.showBenefits),
        showFaq: toBoolean(input.sections?.showFaq, current.sections.showFaq)
      },
      layout: {
        sectionOrder: normalizeSectionOrder(input.layout?.sectionOrder, current.layout.sectionOrder)
      },
      content: {
        socialProof: {
          title: clampText(
            input.content?.socialProof?.title,
            120,
            current.content.socialProof.title
          ),
          logos: normalizeStringList(
            input.content?.socialProof?.logos,
            current.content.socialProof.logos,
            16,
            48
          )
        },
        pricing: {
          eyebrow: clampText(
            input.content?.pricing?.eyebrow,
            40,
            current.content.pricing.eyebrow
          ),
          title: clampText(input.content?.pricing?.title, 120, current.content.pricing.title),
          emptyMessage: clampText(
            input.content?.pricing?.emptyMessage,
            120,
            current.content.pricing.emptyMessage
          )
        },
        proof: {
          items: normalizeProofItems(input.content?.proof?.items, current.content.proof.items)
        },
        benefits: {
          eyebrow: clampText(
            input.content?.benefits?.eyebrow,
            40,
            current.content.benefits.eyebrow
          ),
          title: clampText(input.content?.benefits?.title, 120, current.content.benefits.title),
          items: normalizeBenefitItems(input.content?.benefits?.items, current.content.benefits.items)
        },
        faq: {
          eyebrow: clampText(input.content?.faq?.eyebrow, 40, current.content.faq.eyebrow),
          title: clampText(input.content?.faq?.title, 120, current.content.faq.title),
          items: normalizeFaqItems(input.content?.faq?.items, current.content.faq.items)
        }
      },
      logos: undefined,
      createdAt: current.createdAt,
      updatedAt: now,
      updatedBy: actorUserId
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: plansTableName,
        Item: next
      })
    );

    return this.mapRecord(next);
  }

  private mapRecord(item: FrontendSettingsRecord): FrontendSettings {
    const defaults = buildDefaultSettings(normalizeProductCode(item.productCode));
    const legacyLogos = normalizeStringList(item.logos, defaults.content.socialProof.logos, 16, 48);
    const sectionOrder = normalizeSectionOrder(item.layout?.sectionOrder, defaults.layout.sectionOrder);

    return {
      productCode: normalizeProductCode(item.productCode),
      hero: {
        headerLabel: clampText(item.hero?.headerLabel, 60, defaults.hero.headerLabel),
        heroBadge: clampText(item.hero?.heroBadge, 120, defaults.hero.heroBadge),
        headline: clampOptionalText(item.hero?.headline, 180) ?? defaults.hero.headline,
        subheadline: clampOptionalText(item.hero?.subheadline, 320) ?? defaults.hero.subheadline,
        primaryCtaLabel: clampText(item.hero?.primaryCtaLabel, 48, defaults.hero.primaryCtaLabel),
        secondaryCtaLabel: clampText(item.hero?.secondaryCtaLabel, 48, defaults.hero.secondaryCtaLabel),
        dynamicTitle: clampOptionalText(item.hero?.dynamicTitle, 120) ?? defaults.hero.dynamicTitle,
        dynamicCopy: clampOptionalText(item.hero?.dynamicCopy, 240) ?? defaults.hero.dynamicCopy,
        resourcesTitle: clampOptionalText(item.hero?.resourcesTitle, 90) ?? defaults.hero.resourcesTitle,
        resourcesTags: normalizeStringList(item.hero?.resourcesTags, defaults.hero.resourcesTags, 8, 40)
      },
      sections: {
        showSocialProof: toBoolean(item.sections?.showSocialProof, defaults.sections.showSocialProof),
        showPricing: toBoolean(item.sections?.showPricing, defaults.sections.showPricing),
        showProof: toBoolean(item.sections?.showProof, defaults.sections.showProof),
        showBenefits: toBoolean(item.sections?.showBenefits, defaults.sections.showBenefits),
        showFaq: toBoolean(item.sections?.showFaq, defaults.sections.showFaq)
      },
      layout: {
        sectionOrder
      },
      content: {
        socialProof: {
          title: clampText(item.content?.socialProof?.title, 120, defaults.content.socialProof.title),
          logos: normalizeStringList(
            item.content?.socialProof?.logos ?? legacyLogos,
            defaults.content.socialProof.logos,
            16,
            48
          )
        },
        pricing: {
          eyebrow: clampText(item.content?.pricing?.eyebrow, 40, defaults.content.pricing.eyebrow),
          title: clampText(item.content?.pricing?.title, 120, defaults.content.pricing.title),
          emptyMessage: clampText(
            item.content?.pricing?.emptyMessage,
            120,
            defaults.content.pricing.emptyMessage
          )
        },
        proof: {
          items: normalizeProofItems(item.content?.proof?.items, defaults.content.proof.items)
        },
        benefits: {
          eyebrow: clampText(item.content?.benefits?.eyebrow, 40, defaults.content.benefits.eyebrow),
          title: clampText(item.content?.benefits?.title, 120, defaults.content.benefits.title),
          items: normalizeBenefitItems(item.content?.benefits?.items, defaults.content.benefits.items)
        },
        faq: {
          eyebrow: clampText(item.content?.faq?.eyebrow, 40, defaults.content.faq.eyebrow),
          title: clampText(item.content?.faq?.title, 120, defaults.content.faq.title),
          items: normalizeFaqItems(item.content?.faq?.items, defaults.content.faq.items)
        }
      },
      updatedAt: item.updatedAt,
      updatedBy: item.updatedBy,
      createdAt: item.createdAt
    };
  }
}
