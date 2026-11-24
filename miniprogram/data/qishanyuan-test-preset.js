/**
 * 栖山苑内置测试房源。自包含 CJS，供小程序包及后台共用；不读写数据库。
 * isPublic 沿用物业模型的“公共用房”语义，不能用它表示是否对外展示。
 * 对外测试展示统一经过 listPublicRooms/getPublicRoom；不代表已定价或可签约。
 */
'use strict';

const SCHEMA_VERSION = 1;
const PRESET_ID = 'qishanyuan-test-v1';
const PROJECT_ID = 'qsy-test-v1-community';
const BUILDING_ID = 'qsy-test-v1-building';
const SINGLE_LAYOUT_ID = 'qsy-test-v1-layout-single';

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.keys(value).forEach((key) => freeze(value[key]));
    Object.freeze(value);
  }
  return value;
}
function record(id, fields) {
  return Object.assign({ _id: id, id, schemaVersion: SCHEMA_VERSION, presetId: PRESET_ID, isTestData: true }, fields);
}

function buildPreset() {
  const project = record(PROJECT_ID, {
    kind: 'community', name: '栖山苑', parentId: '', address: null,
    addressStatus: 'pending',
  });
  const building = record(BUILDING_ID, {
    kind: 'building', name: '栖山苑测试楼', parentId: PROJECT_ID,
    address: null, addressStatus: 'pending',
  });
  const singleLayout = record(SINGLE_LAYOUT_ID, {
    kind: 'layout', name: '单间', parentId: BUILDING_ID, code: 'SINGLE',
    bedrooms: 1, livingRooms: 0, rooms: '1室0厅', isPublic: false,
  });
  const floors = [];
  const rooms = [];
  for (let level = 1; level <= 9; level += 1) {
    const floorId = `qsy-test-v1-floor-${level}`;
    const visible = level !== 1;
    const floor = record(floorId, {
      kind: 'floor', name: `${level}层`, parentId: BUILDING_ID,
      level, listingVisible: visible, slots: [],
    });
    const roomCount = level === 1 ? 10 : 29;
    for (let slot = 1; slot <= roomCount; slot += 1) {
      const roomNo = String(level * 100 + slot);
      const id = `qsy-test-v1-room-${roomNo}`;
      const room = record(id, {
        houseId: `QSY-TEST-${roomNo}`,
        communityId: PROJECT_ID, community: project.name,
        buildingId: BUILDING_ID, buildingName: building.name,
        floorId, floorName: floor.name, floorNumber: level,
        roomNo, name: `${building.name} ${roomNo}室`, title: `栖山苑 ${roomNo}室（测试）`,
        layoutId: visible ? SINGLE_LAYOUT_ID : '',
        layoutName: visible ? '单间' : '待配置',
        layoutCode: visible ? 'SINGLE' : '',
        rooms: visible ? '1室0厅' : '',
        layoutStatus: visible ? 'configured' : 'pending',
        // 首层用途/户型未知；隐藏不等于公共用房。
        isPublic: false, listingVisible: visible, visibility: visible ? 'test-public' : 'internal',
        status: 'draft', canBook: false,
        price: null, area: null, address: null,
        priceStatus: 'pending', areaStatus: 'pending', addressStatus: 'pending',
        priceText: '待配置', areaText: '待配置', addressText: '地址待配置',
        sortOrder: rooms.length,
      });
      floor.slots.push({ id, number: roomNo });
      rooms.push(room);
    }
    floors.push(floor);
  }
  return {
    schemaVersion: SCHEMA_VERSION, presetId: PRESET_ID, isTestData: true,
    project, building,
    catalog: [project, building].concat(floors, [singleLayout]),
    rooms,
    summary: {
      floorCount: 9, roomCount: 242, publicRoomCount: 232,
      internalRoomCount: 10, singleRoomCount: 232, unknownLayoutRoomCount: 10,
    },
  };
}

const preset = freeze(buildPreset());
function visibleRoom(room) {
  return room.isTestData === true && room.listingVisible === true &&
    room.visibility === 'test-public' && room.floorNumber >= 2 && room.floorNumber <= 9;
}
function findRoom(idOrRoomNo) {
  if (typeof idOrRoomNo !== 'string') return null;
  return preset.rooms.find((room) => room._id === idOrRoomNo || room.id === idOrRoomNo ||
    room.houseId === idOrRoomNo || room.roomNo === idOrRoomNo) || null;
}

function getPreset() { return copy(preset); }
function listPublicRooms(filters) {
  const options = filters && typeof filters === 'object' ? filters : {};
  return copy(preset.rooms.filter((room) => {
    if (!visibleRoom(room)) return false;
    if (options.floorNumber !== undefined && room.floorNumber !== options.floorNumber) return false;
    if (options.floorId !== undefined && room.floorId !== options.floorId) return false;
    if (options.layoutId !== undefined && room.layoutId !== options.layoutId) return false;
    return true;
  }));
}
function getPublicRoom(idOrRoomNo) {
  const room = findRoom(idOrRoomNo);
  return room && visibleRoom(room) ? copy(room) : null;
}
// 仅供管理/导入或既有内部测试取件；不得作为公开查询的 fallback。
function getInternalRoom(idOrRoomNo) {
  const room = findRoom(idOrRoomNo);
  return room ? copy(room) : null;
}
function isPublicRoom(room) {
  if (!room || typeof room !== 'object') return false;
  const canonical = findRoom(room._id || room.id || room.houseId || room.roomNo);
  return !!canonical && visibleRoom(canonical);
}

module.exports = Object.freeze({
  SCHEMA_VERSION, PRESET_ID, getPreset, listPublicRooms, getPublicRoom, getInternalRoom, isPublicRoom,
});
