import { toAsset, toAssetView } from './asset.mapper';
import type {
  Sponsor,
  SponsorView,
  SponsorWithAttachment,
} from '../../types/entities/finance/sponsor';
import { SponsorModel } from '../models/sponsor.model';

/** TypeORM `SponsorModel` ↔ domain `Sponsor`. */
export function toSponsor(model: SponsorModel): Sponsor {
  return {
    id: model.id,
    name: model.name,
    logoAssetId: model.logoAssetId,
    kind: model.kind,
    matchers: model.matchers ?? [],
  };
}

/** `SponsorModel` with `logoAsset` relation loaded → `SponsorWithAttachment`. */
export function toSponsorWithAttachment(
  model: SponsorModel,
): SponsorWithAttachment {
  return {
    ...toSponsor(model),
    logoAsset: model.logoAsset ? toAsset(model.logoAsset) : null,
  };
}

export function toSponsorView(
  sponsor: SponsorWithAttachment,
  baseUrl: string,
): SponsorView {
  return {
    id: sponsor.id,
    name: sponsor.name,
    logo: sponsor.logoAsset ? toAssetView(sponsor.logoAsset, baseUrl) : null,
    kind: sponsor.kind,
    matchers: sponsor.matchers,
  };
}

export function toSponsorModel(entity: Sponsor): SponsorModel {
  const model = new SponsorModel();
  model.id = entity.id;
  model.name = entity.name;
  model.logoAssetId = entity.logoAssetId;
  model.kind = entity.kind;
  model.matchers = entity.matchers;
  return model;
}
