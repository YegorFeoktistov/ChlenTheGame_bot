export enum ChlenClass {
  CHLENOKNIZHNIK = 'Членокнижник',
  CHLENOMANT = 'Членомант',
  CHLENODIN = 'Членодин',
  OHTONIKNAHLENY = 'Охотник на Члены',
  MASTER_TISYACHI_CHLENOV = 'Мастер тысячи Членов',
}

export const CHLEN_CLASS_SKILLS: Record<ChlenClass, string> = {
  [ChlenClass.CHLENOKNIZHNIK]: 'Членокнижник: "Я читаю древний Член!"',
  [ChlenClass.CHLENOMANT]: 'Членомант: "Я призываю силу Члена!"',
  [ChlenClass.CHLENODIN]: 'Членодин: "Я становлюсь одним с Членом!"',
  [ChlenClass.OHTONIKNAHLENY]: 'Охотник на Члены: "Я выслеживаю Член!"',
  [ChlenClass.MASTER_TISYACHI_CHLENOV]: 'Мастер тысячи Членов: "Я овладеваю тысячей Членов!"',
};

export const CHLEN_CLASSES: readonly ChlenClass[] = Object.values(ChlenClass);

export enum CommandStatus {
  IGNORED = 'ignored',
  WARNING = 'warning',
  SESSION_COOLDOWN = 'session_cooldown',
  SUCCESS = 'success',
  EXCLUDED = 'excluded',
  TURN_SKIPPED = 'turn_skipped',
  ORDER_69 = 'order_69',
}

export enum StrictTurnStatus {
  VALID = 'valid',
  EXCLUDED = 'excluded',
  OUT_OF_TURN_WARNING = 'out_of_turn_warning',
  TURN_SKIPPED = 'turn_skipped',
  ORDER_69 = 'order_69',
}
