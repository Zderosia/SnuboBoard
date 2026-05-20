/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

module.exports.up = async (knex) => {
  await knex.raw(`
    CREATE SEQUENCE card_id_seq START 1;

    CREATE FUNCTION next_card_id(OUT id BIGINT) AS $$
    BEGIN
      SELECT nextval('card_id_seq') INTO id;
    END;
    $$ LANGUAGE PLPGSQL;

    ALTER TABLE card ALTER COLUMN id SET DEFAULT next_card_id();
  `);
};

module.exports.down = async (knex) => {
  await knex.raw(`
    ALTER TABLE card ALTER COLUMN id SET DEFAULT next_id();
    DROP FUNCTION next_card_id(OUT id BIGINT);
    DROP SEQUENCE card_id_seq;
  `);
};
