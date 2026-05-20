/*!
 * Copyright (c) 2024 PLANKA Software GmbH
 * Licensed under the Fair Use License: https://github.com/plankanban/planka/blob/master/LICENSE.md
 */

let lastId = 0;

export const createLocalId = () => {
  lastId += 1;
  return `local:${lastId}`;
};

export const isLocalId = (id) => id.startsWith('local:');
