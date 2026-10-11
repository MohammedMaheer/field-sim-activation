import { api, post, Row } from './api';

export type OcrStage = 'DOCUMENT' | 'ORDER' | 'RECEIPT';
export class OcrTemporaryFailure extends Error {}
export class OcrReadCancelled extends Error {}
export type OcrOperation = { operationId: string; image: string; stage: OcrStage; jobId?: string };
export const ocrOperation = (stage: OcrStage, image: string): OcrOperation => ({ stage, image, operationId: crypto.randomUUID() });

export async function readStageOcr(operation: OcrOperation, options: {
  onStatus?: (message: string) => void; isCurrent?: () => boolean; budgetMs?: number;
} = {}): Promise<Row> {
  const deadline = Date.now() + (options.budgetMs ?? 120000);
  let delay = 2;
  while (Date.now() < deadline) {
    if (options.isCurrent?.() === false) throw new OcrReadCancelled();
    try {
      const job = operation.jobId
        ? await api(`/kyc-captures/ocr-jobs/${operation.jobId}`)
        : await post('/kyc-captures/ocr-jobs', {
          operation_id: operation.operationId, stage: operation.stage, image_base64: operation.image,
        });
      if (options.isCurrent?.() === false) throw new OcrReadCancelled();
      if (job.stage !== operation.stage || !job.id) throw new OcrTemporaryFailure('Scanner response could not be confirmed. Your photo is retained; retry.');
      operation.jobId = job.id;
      if (job.status === 'COMPLETED') return job.result ?? {};
      if (job.status === 'FAILED') throw new Error(job.error || 'This screen could not be read. Try a clearer photo.');
      delay = Math.min(5, Math.max(1, Number(job.retry_after) || 2));
      options.onStatus?.(job.status === 'PROCESSING' ? 'Reading captured screen…' : 'Waiting for scanner…');
    } catch (error: any) {
      if (error instanceof OcrReadCancelled || error instanceof OcrTemporaryFailure) throw error;
      if (typeof error.status === 'number' && error.status !== 429 && error.status < 500) throw error;
      // A completed failed job is a terminal readability error, not network loss.
      if (operation.jobId && error instanceof Error && error.name !== 'TypeError' && (error as Error & {status?: number}).status == null) throw error;
      options.onStatus?.('Photo retained · waiting to reconnect…');
    }
    await new Promise(resolve => window.setTimeout(resolve, delay * 1000));
  }
  throw new OcrTemporaryFailure('Scanner is still processing. Your photo is retained; retry to continue.');
}

export const documentCaptureFields = ['document_image', 'document_check', 'document_type', 'name', 'arabic_name', 'document_number', 'nationality', 'birth_date', 'expiry_date', 'issue_date', 'gender'];
export const orderCaptureFields = ['order_image', 'order_check', 'order_reference', 'product_name', 'package_name', 'monthly_cost', 'prepayment', 'order_type', 'account_number', 'sim_identifier', 'router_serial', 'router_fulfilment', 'advance_transaction_number', 'sr_number', 'receipt_sr_check', 'plan_id', 'plan_name', 'msisdn', 'order_fields', 'payment_image'];
export function withoutStageCapture(current: Row, stage: OcrStage): Row {
  const next = { ...current };
  for (const key of stage === 'DOCUMENT' ? [...documentCaptureFields, ...orderCaptureFields] : orderCaptureFields) delete next[key];
  delete next._ocr;
  if (stage === 'DOCUMENT') next.step = 0;
  return next;
}
export const ocrWarning = (result: Row): string => result._ocr?.warnings?.[0] || '';
