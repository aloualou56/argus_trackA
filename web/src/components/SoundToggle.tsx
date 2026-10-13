import { useEffect, useState } from "react";
import { vibrationLikely } from "../audio/haptics";
import { onSoundChange, play, setSoundOn, soundOn } from "../audio/sounds";
import { useI18n } from "../i18n";
import { Icon } from "./Icon";

/** Sound (and, on phones, vibration) on or off, in the top bar. A toggle; pressed means on. */
export function SoundToggle() {
  const { t } = useI18n();
  const [on, setOn] = useState(soundOn);
  useEffect(() => onSoundChange(setOn), []);
  return (
    <button
      type="button"
      className="sound-toggle"
      aria-pressed={on}
      aria-label={t(vibrationLikely() ? "sound.labelVibrate" : "sound.label")}
      onClick={() => {
        setSoundOn(!on);
        if (!on) play("place"); // a first sound, so turning it on is heard
      }}
    >
      <Icon name={on ? "sound" : "sound_off"} size={20} />
    </button>
  );
}
