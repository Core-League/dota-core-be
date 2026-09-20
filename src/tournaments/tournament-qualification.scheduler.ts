import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Tournament } from './tournaments.entity';
import { TournamentStatus } from './tournaments.model';

/**
 * Автоматичний перехід реєстрації у кваліфікацію.
 *
 * Щохвилини шукає турніри, у яких настав `qualificationStartsAt`, але вони ще
 * в статусі REGISTRATION, і переводить їх у QUALIFICATIONS.
 *
 * Турніри без кваліфікації (`hasQualification = false`) не потрапляють у
 * вибірку: у них немає ні вікна кваліфікації, ні самого етапу, тож вони
 * лишаються в REGISTRATION, доки `TournamentPlayoffScheduler` не стартує сітку
 * о `tournamentStartsAt`.
 *
 * На відміну від старту плей-оф, тут лише один UPDATE без зовнішніх сервісів,
 * тож окремий захист від накладання тіків не потрібен — повторний прохід по
 * тому самому турніру просто не знайде його за фільтром статусу.
 */
@Injectable()
export class TournamentQualificationScheduler {
  private readonly logger = new Logger(TournamentQualificationScheduler.name);

  constructor(
    @InjectRepository(Tournament)
    private readonly tournamentRepo: Repository<Tournament>,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async startDueQualifications(): Promise<void> {
    try {
      const result = await this.tournamentRepo.update(
        {
          tournamentStatus: TournamentStatus.REGISTRATION,
          hasQualification: true,
          qualificationStartsAt: LessThanOrEqual(new Date()),
        },
        { tournamentStatus: TournamentStatus.QUALIFICATIONS },
      );

      if (result.affected) {
        this.logger.log(
          `Moved ${result.affected} tournament(s) from REGISTRATION to QUALIFICATIONS`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Qualification auto-start sweep failed: ${message}`);
    }
  }
}
