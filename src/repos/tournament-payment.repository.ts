import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** Minimal transaction shape the reconciler needs (subset of StoredTransaction). */
export interface ReconcileTransaction {
  id: string;
  comment?: string;
  /** Signed kopecks: positive = income. */
  amount: number;
  time: Date;
}

export interface ReconcileResult {
  paymentId: string;
  reference: string;
  status: 'PAID' | 'UNDERPAID';
}

interface UpdatedPaymentRow {
  id: string;
  reference: string;
  status: 'PAID' | 'UNDERPAID';
}

/**
 * Reconciles Monobank transactions against open tournament entry-fee payments,
 * which live in the v1-owned `tournament_team_payment` table. Following the v2
 * convention (see {@link TeamRepository}), v1 tables are touched via raw SQL so
 * v2 never owns their schema.
 *
 * Matching rule: the transaction comment contains the payment `reference` AND the
 * income amount ≥ the tournament `entryFee` → PAID; a matching reference with a
 * short amount → UNDERPAID. Already-PAID payments are never re-credited.
 *
 * Note: each transaction is evaluated independently; amounts are not summed across
 * multiple transfers (top-up accumulation is out of scope for this phase).
 */
@Injectable()
export class TournamentPaymentRepository {
  private readonly logger = new Logger(TournamentPaymentRepository.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async reconcileTransactions(
    transactions: ReconcileTransaction[],
  ): Promise<ReconcileResult[]> {
    const results: ReconcileResult[] = [];
    for (const tx of transactions) {
      const comment = tx.comment?.trim();
      // Only inbound payments carrying a comment can match a reference.
      if (!comment || tx.amount <= 0) continue;
      results.push(
        ...(await this.reconcileOne(tx.id, comment, tx.amount, tx.time)),
      );
    }
    if (results.length > 0) {
      this.logger.log(
        `Reconciled ${results.length} tournament payment(s): ` +
          results.map((r) => `${r.reference}=${r.status}`).join(', '),
      );
    }
    return results;
  }

  private async reconcileOne(
    transactionId: string,
    comment: string,
    amount: number,
    time: Date,
  ): Promise<ReconcileResult[]> {
    const rows = await this.dataSource.query<UpdatedPaymentRow[]>(
      `UPDATE "tournament_team_payment" AS p
       SET "status" = CASE WHEN $2 >= t."entryFee" THEN 'PAID' ELSE 'UNDERPAID' END,
           "amountPaid" = $2,
           "transactionId" = $1,
           "paidAt" = CASE WHEN $2 >= t."entryFee" THEN $3 ELSE p."paidAt" END,
           "updatedAt" = now()
       FROM "tournament" AS t
       WHERE p."tournamentId" = t."id"
         AND p."status" <> 'PAID'
         AND t."entryFee" IS NOT NULL
         AND t."entryFee" > 0
         AND $4 ILIKE '%' || p."reference" || '%'
       RETURNING p."id", p."reference", p."status"`,
      [transactionId, amount, time, comment],
    );
    return rows.map((r) => ({
      paymentId: r.id,
      reference: r.reference,
      status: r.status,
    }));
  }
}
