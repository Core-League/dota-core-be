import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import { PlayoffService } from '../playoff/playoff.service';
import { Tournament } from './tournaments.entity';
import { TournamentStatus } from './tournaments.model';

/**
 * Автоматичний старт плей-оф.
 *
 * Щохвилини шукає турніри, у яких настав `tournamentStartsAt`, але вони ще не
 * дійшли до плей-оф, і стартує сітку без участі адміна. Кожен турнір
 * обробляється незалежно; помилка на одному не блокує інші, і турнір, який не
 * стартував (напр. через збій зовнішніх сервісів), лишається у своєму статусі —
 * наступний тік спробує ще раз.
 *
 * REGISTRATION теж потрапляє у вибірку: зазвичай турнір переводить у
 * QUALIFICATIONS окремий планувальник о `qualificationStartsAt`, але якщо той
 * тік був пропущений, турнір не має зависнути до початку сітки.
 */
@Injectable()
export class TournamentPlayoffScheduler {
  private readonly logger = new Logger(TournamentPlayoffScheduler.name);

  // Захист від накладання тіків: старт плей-оф важкий (Challonge/Dota2),
  // тож не запускаємо новий прохід, поки не завершився попередній.
  private isSweeping = false;

  constructor(
    @InjectRepository(Tournament)
    private readonly tournamentRepo: Repository<Tournament>,
    private readonly playoffService: PlayoffService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async startDuePlayoffs(): Promise<void> {
    if (this.isSweeping) return;
    this.isSweeping = true;
    try {
      const due = await this.tournamentRepo.find({
        where: {
          tournamentStatus: In([
            TournamentStatus.REGISTRATION,
            TournamentStatus.QUALIFICATIONS,
          ]),
          tournamentStartsAt: LessThanOrEqual(new Date()),
        },
      });

      for (const tournament of due) {
        try {
          await this.playoffService.autoStartPlayoff(tournament.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Auto-start failed for tournament ${tournament.id}; will retry next tick: ${message}`,
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Playoff auto-start sweep failed: ${message}`);
    } finally {
      this.isSweeping = false;
    }
  }
}
