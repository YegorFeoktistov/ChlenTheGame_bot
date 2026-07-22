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

export const CHLEN_CLASSES: readonly ChlenClass[] = Object.values(ChlenClass).filter(
  (v) => typeof v === 'string'
) as unknown as readonly ChlenClass[];
