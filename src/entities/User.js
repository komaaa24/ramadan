const { EntitySchema } = require("typeorm");

const UserEntity = new EntitySchema({
  name: "User",
  tableName: "users",
  columns: {
    id: {
      type: "int",
      primary: true,
      generated: true,
    },
    chatId: {
      type: "varchar",
      length: 32,
      unique: true,
    },
    cityKey: {
      type: "varchar",
      length: 32,
      nullable: true,
    },
    firstName: {
      type: "varchar",
      length: 64,
      nullable: true,
    },
    lastName: {
      type: "varchar",
      length: 64,
      nullable: true,
    },
    username: {
      type: "varchar",
      length: 64,
      nullable: true,
    },
    lastSaharlikNotifyDate: {
      type: "date",
      nullable: true,
    },
    lastIftorNotifyDate: {
      type: "date",
      nullable: true,
    },
    createdAt: {
      type: "timestamptz",
      createDate: true,
    },
    updatedAt: {
      type: "timestamptz",
      updateDate: true,
    },
  },
  indices: [{ columns: ["chatId"], unique: true }],
});

module.exports = { UserEntity };
