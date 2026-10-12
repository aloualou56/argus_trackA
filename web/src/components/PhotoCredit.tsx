import type { Photo } from "../game/types";
import { useI18n } from "../i18n";

/** Who took a photo and under which licence, with links to both: shown wherever the photo is. */
export function PhotoCredit({ photo }: { photo: Photo }) {
  const { t } = useI18n();
  return (
    <span className="photo-credit">
      {t("photo.by", { author: photo.author })} ·{" "}
      <a href={photo.license_url} target="_blank" rel="noopener noreferrer">
        {photo.license}
      </a>{" "}
      ·{" "}
      <a href={photo.source} target="_blank" rel="noopener noreferrer">
        {t("photo.via")}
      </a>
    </span>
  );
}
