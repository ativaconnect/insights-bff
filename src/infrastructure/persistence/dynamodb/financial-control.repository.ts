import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuid } from 'uuid';
import { dynamoDbDocumentClient, financeTableName } from './dynamo-client';

export type FinancialExpenseType = 'FIXED' | 'VARIABLE' | 'FIXED_VARIABLE';
export type FinancialExpenseStatus = 'PLANNED' | 'OPEN' | 'PAID' | 'CANCELLED' | 'PENDING_VALUE';
export type FinancialPaymentMethod = 'PIX' | 'CARD' | 'BANK_SLIP' | 'TRANSFER' | 'CASH' | 'OTHER';
export type FinancialSupplierStatus = 'ACTIVE' | 'INACTIVE';
export type FinancialRecurringFrequency = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface FinancialSupplier {
  id: string;
  name: string;
  document?: string;
  category?: string;
  email?: string;
  phone?: string;
  status: FinancialSupplierStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinancialExpense {
  id: string;
  occurredOn: string;
  dueOn?: string;
  description: string;
  type: FinancialExpenseType;
  category: string;
  amount: number;
  status: FinancialExpenseStatus;
  supplierId?: string;
  supplierName?: string;
  paymentMethod?: FinancialPaymentMethod;
  notes?: string;
  isForecast: boolean;
  competenceMonth: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  sourceTemplateId?: string;
  installmentGroupId?: string;
  installmentNumber?: number;
  installmentTotal?: number;
}

export interface FinancialForecastMonth {
  month: string;
  expectedRevenue: number;
  expectedFixedCosts: number;
  expectedVariableCosts: number;
  notes?: string;
  updatedAt: string;
  updatedBy: string;
  createdAt: string;
}

export interface FinancialRecurringTemplate {
  id: string;
  name: string;
  category: string;
  type: FinancialExpenseType;
  recurringFrequency: FinancialRecurringFrequency;
  updateDay: number;
  dueDay?: number;
  requiresValueUpdate: boolean;
  defaultAmount?: number;
  supplierId?: string;
  supplierName?: string;
  paymentMethod?: FinancialPaymentMethod;
  startMonth: string;
  endMonth?: string;
  active: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

const supplierKey = (supplierId: string) => ({
  PK: `FINANCE#SUPPLIER#${supplierId}`,
  SK: 'PROFILE'
});

const expenseKey = (expenseId: string) => ({
  PK: `FINANCE#EXPENSE#${expenseId}`,
  SK: 'PROFILE'
});

const forecastKey = (month: string) => ({
  PK: `FINANCE#FORECAST#${month}`,
  SK: 'PROFILE'
});

const templateKey = (templateId: string) => ({
  PK: `FINANCE#TEMPLATE#${templateId}`,
  SK: 'PROFILE'
});

const templateInstanceKey = (templateId: string, month: string) => ({
  PK: `FINANCE#TEMPLATE#${templateId}`,
  SK: `INSTANCE#${month}`
});

const toMonth = (dateOnly: string): string => dateOnly.slice(0, 7);

const normalizeMonth = (value: string): string => value.slice(0, 7);

const daysInMonth = (month: string): number => {
  const [yearRaw, monthRaw] = normalizeMonth(month).split('-');
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  return new Date(year, monthIndex + 1, 0).getDate();
};

const dayDate = (month: string, day: number): string => {
  const safeDay = Math.max(1, Math.min(day, daysInMonth(month)));
  return `${month}-${String(safeDay).padStart(2, '0')}`;
};

const monthsDiff = (fromMonth: string, toMonthValue: string): number => {
  const [fy, fm] = normalizeMonth(fromMonth).split('-').map(Number);
  const [ty, tm] = normalizeMonth(toMonthValue).split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
};

const shouldGenerateForMonth = (template: FinancialRecurringTemplate, month: string): boolean => {
  const targetMonth = normalizeMonth(month);
  const startMonth = normalizeMonth(template.startMonth);
  if (targetMonth < startMonth) return false;
  if (template.endMonth && targetMonth > normalizeMonth(template.endMonth)) return false;
  const diff = monthsDiff(startMonth, targetMonth);
  if (diff < 0) return false;
  if (template.recurringFrequency === 'MONTHLY') return true;
  if (template.recurringFrequency === 'QUARTERLY') return diff % 3 === 0;
  if (template.recurringFrequency === 'YEARLY') return diff % 12 === 0;
  return false;
};

const nextMonthFromDate = (dateOnly: string): string => {
  const [yearRaw, monthRaw] = dateOnly.slice(0, 7).split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const date = new Date(year, month, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const addMonthsToDate = (dateOnly: string, monthsToAdd: number): string => {
  const [yearRaw, monthRaw, dayRaw] = dateOnly.slice(0, 10).split('-');
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  const day = Number(dayRaw);
  const candidate = new Date(year, monthIndex + monthsToAdd, 1);
  const monthText = `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, '0')}`;
  return dayDate(monthText, day);
};

export class FinancialControlRepository {
  async listSuppliers(): Promise<FinancialSupplier[]> {
    const items: FinancialSupplier[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const output = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: financeTableName,
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: {
            ':pk': 'ENTITY#FIN_SUPPLIER'
          },
          ExclusiveStartKey: lastEvaluatedKey
        })
      );

      items.push(...((output.Items ?? []) as FinancialSupplier[]));
      lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getSupplierById(supplierId: string): Promise<FinancialSupplier | null> {
    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: financeTableName,
        Key: supplierKey(supplierId)
      })
    );
    return (output.Item as FinancialSupplier | undefined) ?? null;
  }

  async createSupplier(input: {
    name: string;
    document?: string;
    category?: string;
    email?: string;
    phone?: string;
    status?: FinancialSupplierStatus;
    notes?: string;
  }): Promise<FinancialSupplier> {
    const now = new Date().toISOString();
    const id = uuid();
    const supplier: FinancialSupplier = {
      id,
      name: input.name.trim(),
      document: input.document?.trim() || undefined,
      category: input.category?.trim() || undefined,
      email: input.email?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      status: input.status ?? 'ACTIVE',
      notes: input.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: financeTableName,
        Item: {
          ...supplierKey(id),
          GSI2PK: 'ENTITY#FIN_SUPPLIER',
          GSI2SK: `${now}#${id}`,
          entityType: 'FIN_SUPPLIER',
          ...supplier
        },
        ConditionExpression: 'attribute_not_exists(PK)'
      })
    );

    return supplier;
  }

  async updateSupplier(
    supplierId: string,
    input: {
      name?: string;
      document?: string;
      category?: string;
      email?: string;
      phone?: string;
      status?: FinancialSupplierStatus;
      notes?: string;
    }
  ): Promise<FinancialSupplier | null> {
    const current = await this.getSupplierById(supplierId);
    if (!current) return null;
    const next: FinancialSupplier = {
      ...current,
      name: input.name?.trim() || current.name,
      document: input.document !== undefined ? (input.document.trim() || undefined) : current.document,
      category: input.category !== undefined ? (input.category.trim() || undefined) : current.category,
      email: input.email !== undefined ? (input.email.trim() || undefined) : current.email,
      phone: input.phone !== undefined ? (input.phone.trim() || undefined) : current.phone,
      status: input.status ?? current.status,
      notes: input.notes !== undefined ? (input.notes.trim() || undefined) : current.notes,
      updatedAt: new Date().toISOString()
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: financeTableName,
        Item: {
          ...supplierKey(supplierId),
          GSI2PK: 'ENTITY#FIN_SUPPLIER',
          GSI2SK: `${current.createdAt}#${supplierId}`,
          entityType: 'FIN_SUPPLIER',
          ...next
        }
      })
    );

    return next;
  }

  async listExpenses(): Promise<FinancialExpense[]> {
    const items: FinancialExpense[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const output = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: financeTableName,
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: {
            ':pk': 'ENTITY#FIN_EXPENSE'
          },
          ExclusiveStartKey: lastEvaluatedKey
        })
      );
      items.push(...((output.Items ?? []) as FinancialExpense[]));
      lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return items.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  }

  async listExpensesByMonth(
    month: string,
    status?: FinancialExpenseStatus
  ): Promise<FinancialExpense[]> {
    const normalizedMonth = normalizeMonth(month);
    const normalizedStatus = status?.trim().toUpperCase() as FinancialExpenseStatus | undefined;
    const keyCondition = normalizedStatus
      ? 'GSI3PK = :pk AND begins_with(GSI3SK, :skPrefix)'
      : 'GSI3PK = :pk';
    const expressionValues: Record<string, string> = {
      ':pk': `FIN_EXPENSE#MONTH#${normalizedMonth}`
    };
    if (normalizedStatus) {
      expressionValues[':skPrefix'] = `${normalizedStatus}#`;
    }

    const items: FinancialExpense[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    try {
      do {
        const output = await dynamoDbDocumentClient.send(
          new QueryCommand({
            TableName: financeTableName,
            IndexName: 'GSI3',
            KeyConditionExpression: keyCondition,
            ExpressionAttributeValues: expressionValues,
            ExclusiveStartKey: lastEvaluatedKey
          })
        );
        items.push(...((output.Items ?? []) as FinancialExpense[]));
        lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastEvaluatedKey);
    } catch {
      // Backward compatibility for environments where GSI3 is not deployed yet.
      const fallback = await this.listExpenses();
      return fallback.filter((item) => {
        if (normalizeMonth(item.competenceMonth) !== normalizedMonth) return false;
        if (normalizedStatus && item.status !== normalizedStatus) return false;
        return true;
      });
    }

    return items.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  }

  async getExpenseById(expenseId: string): Promise<FinancialExpense | null> {
    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: financeTableName,
        Key: expenseKey(expenseId)
      })
    );
    return (output.Item as FinancialExpense | undefined) ?? null;
  }

  async createExpense(input: {
    occurredOn: string;
    dueOn?: string;
    description: string;
    type: FinancialExpenseType;
    category: string;
    amount: number;
    status?: FinancialExpenseStatus;
    supplierId?: string;
    supplierName?: string;
    paymentMethod?: FinancialPaymentMethod;
    notes?: string;
    isForecast?: boolean;
    createdBy: string;
    sourceTemplateId?: string;
    installmentGroupId?: string;
    installmentNumber?: number;
    installmentTotal?: number;
  }): Promise<FinancialExpense> {
    const now = new Date().toISOString();
    const id = uuid();
    const occurredOn = input.occurredOn.slice(0, 10);
    const expense: FinancialExpense = {
      id,
      occurredOn,
      dueOn: input.dueOn?.slice(0, 10),
      description: input.description.trim(),
      type: input.type,
      category: input.category.trim(),
      amount: Number(input.amount),
      status: input.status ?? 'OPEN',
      supplierId: input.supplierId?.trim() || undefined,
      supplierName: input.supplierName?.trim() || undefined,
      paymentMethod: input.paymentMethod,
      notes: input.notes?.trim() || undefined,
      isForecast: Boolean(input.isForecast),
      competenceMonth: toMonth(occurredOn),
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      sourceTemplateId: input.sourceTemplateId,
      installmentGroupId: input.installmentGroupId,
      installmentNumber: input.installmentNumber,
      installmentTotal: input.installmentTotal
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: financeTableName,
        Item: {
          ...expenseKey(id),
          GSI2PK: 'ENTITY#FIN_EXPENSE',
          GSI2SK: `${expense.occurredOn}#${id}`,
          GSI3PK: `FIN_EXPENSE#MONTH#${expense.competenceMonth}`,
          GSI3SK: `${expense.status}#${expense.occurredOn}#${id}`,
          entityType: 'FIN_EXPENSE',
          ...expense
        },
        ConditionExpression: 'attribute_not_exists(PK)'
      })
    );

    return expense;
  }

  async updateExpense(
    expenseId: string,
    input: {
      occurredOn?: string;
      dueOn?: string;
      description?: string;
      type?: FinancialExpenseType;
      category?: string;
      amount?: number;
      status?: FinancialExpenseStatus;
      supplierId?: string;
      supplierName?: string;
      paymentMethod?: FinancialPaymentMethod;
      notes?: string;
      isForecast?: boolean;
    }
  ): Promise<FinancialExpense | null> {
    const current = await this.getExpenseById(expenseId);
    if (!current) return null;

    const occurredOn = input.occurredOn?.slice(0, 10) ?? current.occurredOn;
    const next: FinancialExpense = {
      ...current,
      occurredOn,
      dueOn: input.dueOn !== undefined ? input.dueOn.slice(0, 10) : current.dueOn,
      description: input.description?.trim() || current.description,
      type: input.type ?? current.type,
      category: input.category?.trim() || current.category,
      amount: input.amount !== undefined ? Number(input.amount) : current.amount,
      status: input.status ?? current.status,
      supplierId: input.supplierId !== undefined ? (input.supplierId.trim() || undefined) : current.supplierId,
      supplierName: input.supplierName !== undefined ? (input.supplierName.trim() || undefined) : current.supplierName,
      paymentMethod: input.paymentMethod ?? current.paymentMethod,
      notes: input.notes !== undefined ? (input.notes.trim() || undefined) : current.notes,
      isForecast: input.isForecast !== undefined ? Boolean(input.isForecast) : current.isForecast,
      competenceMonth: toMonth(occurredOn),
      updatedAt: new Date().toISOString()
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: financeTableName,
        Item: {
          ...expenseKey(expenseId),
          GSI2PK: 'ENTITY#FIN_EXPENSE',
          GSI2SK: `${next.occurredOn}#${expenseId}`,
          GSI3PK: `FIN_EXPENSE#MONTH#${next.competenceMonth}`,
          GSI3SK: `${next.status}#${next.occurredOn}#${expenseId}`,
          entityType: 'FIN_EXPENSE',
          ...next
        }
      })
    );

    return next;
  }

  async listRecurringTemplates(): Promise<FinancialRecurringTemplate[]> {
    const items: FinancialRecurringTemplate[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const output = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: financeTableName,
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: {
            ':pk': 'ENTITY#FIN_TEMPLATE'
          },
          ExclusiveStartKey: lastEvaluatedKey
        })
      );
      items.push(...((output.Items ?? []) as FinancialRecurringTemplate[]));
      lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createRecurringTemplate(input: {
    name: string;
    category: string;
    type: FinancialExpenseType;
    recurringFrequency: FinancialRecurringFrequency;
    updateDay: number;
    dueDay?: number;
    requiresValueUpdate: boolean;
    defaultAmount?: number;
    supplierId?: string;
    supplierName?: string;
    paymentMethod?: FinancialPaymentMethod;
    startMonth: string;
    endMonth?: string;
    active?: boolean;
    notes?: string;
    createdBy: string;
  }): Promise<FinancialRecurringTemplate> {
    const now = new Date().toISOString();
    const id = uuid();
    const template: FinancialRecurringTemplate = {
      id,
      name: input.name.trim(),
      category: input.category.trim(),
      type: input.type,
      recurringFrequency: input.recurringFrequency,
      updateDay: Math.max(1, Math.min(31, Number(input.updateDay))),
      dueDay: input.dueDay ? Math.max(1, Math.min(31, Number(input.dueDay))) : undefined,
      requiresValueUpdate: Boolean(input.requiresValueUpdate),
      defaultAmount: input.defaultAmount !== undefined ? Number(input.defaultAmount) : undefined,
      supplierId: input.supplierId?.trim() || undefined,
      supplierName: input.supplierName?.trim() || undefined,
      paymentMethod: input.paymentMethod,
      startMonth: normalizeMonth(input.startMonth),
      endMonth: input.endMonth ? normalizeMonth(input.endMonth) : undefined,
      active: input.active ?? true,
      notes: input.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: financeTableName,
        Item: {
          ...templateKey(id),
          GSI2PK: 'ENTITY#FIN_TEMPLATE',
          GSI2SK: `${now}#${id}`,
          entityType: 'FIN_RECURRING_TEMPLATE',
          ...template
        },
        ConditionExpression: 'attribute_not_exists(PK)'
      })
    );

    return template;
  }

  async updateRecurringTemplate(
    templateId: string,
    input: Partial<Omit<FinancialRecurringTemplate, 'id' | 'createdAt' | 'createdBy'>>
  ): Promise<FinancialRecurringTemplate | null> {
    const currentOutput = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: financeTableName,
        Key: templateKey(templateId)
      })
    );
    const current = currentOutput.Item as FinancialRecurringTemplate | undefined;
    if (!current) return null;

    const next: FinancialRecurringTemplate = {
      ...current,
      name: input.name?.trim() || current.name,
      category: input.category?.trim() || current.category,
      type: input.type ?? current.type,
      recurringFrequency: input.recurringFrequency ?? current.recurringFrequency,
      updateDay: input.updateDay !== undefined ? Math.max(1, Math.min(31, Number(input.updateDay))) : current.updateDay,
      dueDay: input.dueDay !== undefined ? Math.max(1, Math.min(31, Number(input.dueDay))) : current.dueDay,
      requiresValueUpdate: input.requiresValueUpdate !== undefined ? Boolean(input.requiresValueUpdate) : current.requiresValueUpdate,
      defaultAmount: input.defaultAmount !== undefined ? Number(input.defaultAmount) : current.defaultAmount,
      supplierId: input.supplierId !== undefined ? (input.supplierId?.trim() || undefined) : current.supplierId,
      supplierName: input.supplierName !== undefined ? (input.supplierName?.trim() || undefined) : current.supplierName,
      paymentMethod: input.paymentMethod ?? current.paymentMethod,
      startMonth: input.startMonth ? normalizeMonth(input.startMonth) : current.startMonth,
      endMonth: input.endMonth !== undefined ? (input.endMonth ? normalizeMonth(input.endMonth) : undefined) : current.endMonth,
      active: input.active !== undefined ? Boolean(input.active) : current.active,
      notes: input.notes !== undefined ? (input.notes?.trim() || undefined) : current.notes,
      updatedAt: new Date().toISOString()
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: financeTableName,
        Item: {
          ...templateKey(templateId),
          GSI2PK: 'ENTITY#FIN_TEMPLATE',
          GSI2SK: `${current.createdAt}#${templateId}`,
          entityType: 'FIN_RECURRING_TEMPLATE',
          ...next
        }
      })
    );

    return next;
  }

  async generateRecurringExpensesForMonth(month: string, actorId: string): Promise<{ created: FinancialExpense[]; skipped: number }> {
    const targetMonth = normalizeMonth(month);
    const templates = await this.listRecurringTemplates();
    const created: FinancialExpense[] = [];
    let skipped = 0;

    for (const template of templates) {
      if (!template.active || !shouldGenerateForMonth(template, targetMonth)) {
        skipped += 1;
        continue;
      }

      const lockOutput = await dynamoDbDocumentClient.send(
        new GetCommand({
          TableName: financeTableName,
          Key: templateInstanceKey(template.id, targetMonth)
        })
      );
      if (lockOutput.Item) {
        skipped += 1;
        continue;
      }

      const occurredOn = dayDate(targetMonth, template.updateDay);
      const dueOn = template.dueDay ? dayDate(targetMonth, template.dueDay) : undefined;
      const needsUpdate = template.requiresValueUpdate;
      const amount = needsUpdate ? Number(template.defaultAmount ?? 0) : Number(template.defaultAmount ?? 0);
      const status: FinancialExpenseStatus = needsUpdate ? 'PENDING_VALUE' : 'OPEN';

      const expense = await this.createExpense({
        occurredOn,
        dueOn,
        description: template.name,
        type: template.type,
        category: template.category,
        amount,
        status,
        supplierId: template.supplierId,
        supplierName: template.supplierName,
        paymentMethod: template.paymentMethod,
        notes: template.notes,
        isForecast: false,
        createdBy: actorId,
        sourceTemplateId: template.id
      });

      await dynamoDbDocumentClient.send(
        new PutCommand({
          TableName: financeTableName,
          Item: {
            ...templateInstanceKey(template.id, targetMonth),
            entityType: 'FIN_TEMPLATE_INSTANCE',
            templateId: template.id,
            month: targetMonth,
            expenseId: expense.id,
            createdAt: new Date().toISOString()
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
        })
      );

      created.push(expense);
    }

    return { created, skipped };
  }

  async listPendingValueUpdates(month: string): Promise<FinancialExpense[]> {
    const targetMonth = normalizeMonth(month);
    const all = await this.listExpenses();
    return all
      .filter((expense) => expense.competenceMonth === targetMonth)
      .filter((expense) => expense.status === 'PENDING_VALUE' || (expense.sourceTemplateId && Number(expense.amount) <= 0));
  }

  async generateInstallments(input: {
    description: string;
    category: string;
    type: FinancialExpenseType;
    totalAmount: number;
    installments: number;
    firstDueOn: string;
    recurringFrequency: FinancialRecurringFrequency;
    supplierId?: string;
    supplierName?: string;
    paymentMethod?: FinancialPaymentMethod;
    notes?: string;
    createdBy: string;
  }): Promise<FinancialExpense[]> {
    const installments = Math.max(1, Math.floor(Number(input.installments)));
    const totalAmount = Number(input.totalAmount);
    const groupId = uuid();
    const baseInstallment = Number((totalAmount / installments).toFixed(2));
    let allocated = 0;
    const result: FinancialExpense[] = [];

    for (let i = 0; i < installments; i += 1) {
      const installmentNumber = i + 1;
      const occurredOn = addMonthsToDate(input.firstDueOn, i * (input.recurringFrequency === 'MONTHLY' ? 1 : input.recurringFrequency === 'QUARTERLY' ? 3 : 12));
      const amount = installmentNumber === installments
        ? Number((totalAmount - allocated).toFixed(2))
        : baseInstallment;
      allocated = Number((allocated + amount).toFixed(2));

      const expense = await this.createExpense({
        occurredOn,
        dueOn: occurredOn,
        description: `${input.description.trim()} (${installmentNumber}/${installments})`,
        type: input.type,
        category: input.category.trim(),
        amount,
        status: 'OPEN',
        supplierId: input.supplierId,
        supplierName: input.supplierName,
        paymentMethod: input.paymentMethod,
        notes: input.notes,
        isForecast: false,
        createdBy: input.createdBy,
        installmentGroupId: groupId,
        installmentNumber,
        installmentTotal: installments
      });
      result.push(expense);
    }

    return result;
  }

  async getForecastMonth(month: string): Promise<FinancialForecastMonth | null> {
    const normalizedMonth = month.slice(0, 7);
    const output = await dynamoDbDocumentClient.send(
      new GetCommand({
        TableName: financeTableName,
        Key: forecastKey(normalizedMonth)
      })
    );
    return (output.Item as FinancialForecastMonth | undefined) ?? null;
  }

  async listForecastMonths(): Promise<FinancialForecastMonth[]> {
    const items: FinancialForecastMonth[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const output = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: financeTableName,
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: {
            ':pk': 'ENTITY#FIN_FORECAST'
          },
          ExclusiveStartKey: lastEvaluatedKey
        })
      );
      items.push(...((output.Items ?? []) as FinancialForecastMonth[]));
      lastEvaluatedKey = output.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return items.sort((a, b) => b.month.localeCompare(a.month));
  }

  async upsertForecastMonth(input: {
    month: string;
    expectedRevenue: number;
    expectedFixedCosts: number;
    expectedVariableCosts: number;
    notes?: string;
    updatedBy: string;
  }): Promise<FinancialForecastMonth> {
    const normalizedMonth = input.month.slice(0, 7);
    const now = new Date().toISOString();
    const current = await this.getForecastMonth(normalizedMonth);
    const next: FinancialForecastMonth = {
      month: normalizedMonth,
      expectedRevenue: Number(input.expectedRevenue),
      expectedFixedCosts: Number(input.expectedFixedCosts),
      expectedVariableCosts: Number(input.expectedVariableCosts),
      notes: input.notes?.trim() || undefined,
      updatedBy: input.updatedBy,
      updatedAt: now,
      createdAt: current?.createdAt ?? now
    };

    await dynamoDbDocumentClient.send(
      new PutCommand({
        TableName: financeTableName,
        Item: {
          ...forecastKey(normalizedMonth),
          GSI2PK: 'ENTITY#FIN_FORECAST',
          GSI2SK: `${normalizedMonth}#PROFILE`,
          entityType: 'FIN_FORECAST_MONTH',
          ...next
        }
      })
    );

    return next;
  }
}
