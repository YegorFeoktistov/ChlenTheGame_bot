/* eslint-disable @typescript-eslint/no-explicit-any */
import { sqlite } from './sqlite.js';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export const api = {
  async sendMessage(params: {
    chat_id: number | string;
    text: string;
    parse_mode?: string;
    reply_to_message_id?: number;
  }) {
    if (!BOT_TOKEN) {
      console.warn('Warning: TELEGRAM_BOT_TOKEN is not set in .env');
      return;
    }
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: params.chat_id,
        text: params.text,
        parse_mode: params.parse_mode,
        reply_to_message_id: params.reply_to_message_id,
      }),
    });
    return await res.json();
  },
};

export const db = {
  select() {
    return {
      from(tableObj: any) {
        const tableName = tableObj.name;
        let whereClause = '';
        let orderByClause = '';
        let params: any[] = [];

        const queryObj = {
          where(conditionObj: any) {
            if (conditionObj && conditionObj.sql) {
              whereClause = ` WHERE ${conditionObj.sql}`;
              params = conditionObj.params || [];
            }
            return queryObj;
          },
          orderBy(orderObj: any) {
            if (orderObj && orderObj.column) {
              orderByClause = ` ORDER BY ${orderObj.column} DESC`;
            }
            return queryObj;
          },
          run() {
            const sqlStr = `SELECT * FROM ${tableName}${whereClause}${orderByClause}`;
            const stmt = sqlite.prepare(sqlStr);
            const rows = stmt.all(...params);
            return rows.map((r: any) => camelizeKeys(r));
          },
        };
        return queryObj;
      },
    };
  },

  insert(tableObj: any) {
    const tableName = tableObj.name;
    let valuesObj: Record<string, any> = {};

    return {
      values(val: Record<string, any>) {
        valuesObj = val;
        return {
          onConflictDoUpdate(conflictOpts: any) {
            return {
              run() {
                return executeUpsert(tableName, valuesObj, conflictOpts);
              },
            };
          },
          run() {
            return executeUpsert(tableName, valuesObj, null);
          },
        };
      },
    };
  },

  delete(tableObj: any) {
    const tableName = tableObj.name;
    return {
      where(conditionObj: any) {
        return {
          run() {
            const sqlStr = `DELETE FROM ${tableName} WHERE ${conditionObj.sql}`;
            const stmt = sqlite.prepare(sqlStr);
            return stmt.run(...(conditionObj.params || []));
          },
        };
      },
    };
  },

  update(tableObj: any) {
    const tableName = tableObj.name;
    let setObj: Record<string, any> = {};

    return {
      set(val: Record<string, any>) {
        setObj = val;
        return {
          where(conditionObj: any) {
            return {
              run() {
                const setKeys = Object.keys(setObj);
                const setSqlParts: string[] = [];
                const setParams: any[] = [];
                for (const k of setKeys) {
                  const v = setObj[k];
                  const colName = decamelize(k);
                  if (v && typeof v === 'object' && v.sql !== undefined) {
                    setSqlParts.push(`${colName} = ${v.sql}`);
                    if (v.params) setParams.push(...v.params);
                  } else {
                    setSqlParts.push(`${colName} = ?`);
                    setParams.push(v);
                  }
                }

                let whereClause = '';
                const whereParams: any[] = [];
                if (conditionObj) {
                  whereClause = ` WHERE ${conditionObj.sql}`;
                  if (conditionObj.params) whereParams.push(...conditionObj.params);
                }

                const sqlStr = `UPDATE ${tableName} SET ${setSqlParts.join(', ')}${whereClause}`;
                const stmt = sqlite.prepare(sqlStr);
                return stmt.run(...setParams, ...whereParams);
              },
            };
          },
        };
      },
    };
  },
};

// DSL Functions for schema and queries
export function table(name: string, columns: Record<string, any>, extra?: any) {
  const tableObj: any = { name, columns, ...columns };
  if (extra) {
    extra(columns);
  }
  return tableObj;
}

export function integer(name: string, options?: any) {
  const colObj = {
    name,
    type: 'INTEGER',
    options,
    defaultVal: undefined as any,
    default(val: any) {
      colObj.defaultVal = val;
      return colObj;
    },
  };
  return colObj;
}

export function text(name: string) {
  const colObj = {
    name,
    type: 'TEXT',
    defaultVal: undefined as any,
    default(val: any) {
      colObj.defaultVal = val;
      return colObj;
    },
    primaryKey() {
      return { name, type: 'TEXT', isPk: true };
    },
  };
  return colObj;
}

export function primaryKey(...cols: any[]) {
  return { pk: cols };
}

export function sql(strings: TemplateStringsArray, ...values: any[]) {
  let sqlStr = strings[0];
  const params: any[] = [];
  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (val && typeof val === 'object' && val.name) {
      sqlStr += decamelize(val.name) + strings[i + 1];
    } else {
      sqlStr += '?' + strings[i + 1];
      params.push(val);
    }
  }
  return { sql: sqlStr, params };
}

export function eq(colObj: any, val: any) {
  const colName = typeof colObj === 'string' ? decamelize(colObj) : decamelize(colObj.name);
  return { sql: `${colName} = ?`, params: [val] };
}

export function and(...conditions: any[]) {
  const sqlParts = conditions.map((c) => c.sql);
  const params = conditions.flatMap((c) => c.params);
  return { sql: `(${sqlParts.join(' AND ')})`, params };
}

export function desc(colObj: any) {
  const colName = typeof colObj === 'string' ? decamelize(colObj) : decamelize(colObj.name);
  return { column: colName, dir: 'DESC' };
}

function camelizeKeys(obj: Record<string, any>): Record<string, any> {
  const res: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    res[camelKey] = val;
  }
  return res;
}

function decamelize(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function executeUpsert(tableName: string, valuesObj: Record<string, any>, conflictOpts: any) {
  const keys = Object.keys(valuesObj);
  const colNames = keys.map(decamelize);
  const placeholders = keys.map(() => '?').join(', ');
  const params = keys.map((k) => {
    const v = valuesObj[k];
    if (v instanceof Date) return Math.floor(v.getTime() / 1000);
    return v ?? null;
  });

  if (!conflictOpts) {
    const sqlStr = `INSERT INTO ${tableName} (${colNames.join(', ')}) VALUES (${placeholders})`;
    const stmt = sqlite.prepare(sqlStr);
    return stmt.run(...params);
  }

  // Handle ON CONFLICT
  const targetCols = Array.isArray(conflictOpts.target)
    ? conflictOpts.target.map((c: any) =>
        typeof c === 'string' ? decamelize(c) : decamelize(c.name)
      )
    : [
        typeof conflictOpts.target === 'string'
          ? decamelize(conflictOpts.target)
          : decamelize(conflictOpts.target.name),
      ];

  const updateKeys = Object.keys(conflictOpts.set || {});
  const updateAssignments = updateKeys.map((k) => `${decamelize(k)} = ?`);
  const updateParams = updateKeys.map((k) => {
    const v = conflictOpts.set[k];
    if (v instanceof Date) return Math.floor(v.getTime() / 1000);
    return v ?? null;
  });

  const sqlStr = `INSERT INTO ${tableName} (${colNames.join(', ')}) VALUES (${placeholders})
    ON CONFLICT(${targetCols.join(', ')}) DO UPDATE SET ${updateAssignments.join(', ')}`;

  const stmt = sqlite.prepare(sqlStr);
  return stmt.run(...params, ...updateParams);
}
