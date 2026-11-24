'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const presetApi = require('../miniprogram/data/qishanyuan-test-preset.js');

function expectedRoomNumbers() {
  const numbers = [];
  for (let room = 101; room <= 110; room += 1) numbers.push(String(room));
  for (let floor = 2; floor <= 9; floor += 1) {
    for (let slot = 1; slot <= 29; slot += 1) numbers.push(String(floor * 100 + slot));
  }
  return numbers;
}

test('栖山苑单一内置源提供9层242间，编号及层级稳定且唯一', () => {
  const before = presetApi.getPreset();
  assert.equal(before.schemaVersion, 1);
  assert.equal(before.presetId, 'qishanyuan-test-v1');
  assert.equal(before.project.name, '栖山苑');
  assert.equal(before.building.name, '栖山苑测试楼');
  assert.equal(before.building.parentId, before.project._id);
  const floors = before.catalog.filter((item) => item.kind === 'floor');
  assert.deepEqual(floors.map((item) => item.level), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(before.rooms.length, 242);
  assert.deepEqual(before.rooms.map((room) => room.roomNo), expectedRoomNumbers());
  assert.equal(new Set(before.rooms.map((room) => room._id)).size, 242);
  assert.equal(new Set(before.rooms.map((room) => room.houseId)).size, 242);
  assert.equal(new Set(before.catalog.map((item) => item._id)).size, before.catalog.length);
  for (const floor of floors) {
    const rooms = before.rooms.filter((room) => room.floorId === floor._id);
    assert.equal(rooms.length, floor.level === 1 ? 10 : 29);
    assert.deepEqual(floor.slots, rooms.map((room) => ({ id: room._id, number: room.roomNo })));
    assert.equal(floor.parentId, before.building._id);
    for (const room of rooms) {
      assert.equal(room.communityId, before.project._id);
      assert.equal(room.buildingId, before.building._id);
      assert.equal(room.floorNumber, floor.level);
    }
  }
  assert.deepEqual(presetApi.getPreset(), before);
});

test('公开测试列表仅232个单间；首层10间保持隐藏、草稿、未知户型', () => {
  const all = presetApi.getPreset();
  const visible = presetApi.listPublicRooms();
  assert.equal(visible.length, 232);
  assert.deepEqual(visible.map((room) => room.roomNo), expectedRoomNumbers().slice(10));
  const single = all.catalog.find((item) => item.kind === 'layout');
  assert.equal(single.name, '单间');
  assert.equal(single.bedrooms, 1);
  assert.equal(single.livingRooms, 0);
  for (const room of visible) {
    assert.equal(room.layoutId, single._id);
    assert.equal(room.layoutName, '单间');
    assert.equal(room.rooms, '1室0厅');
    assert.equal(presetApi.isPublicRoom(room), true);
    assert.equal(room.isPublic, false, 'isPublic表示公共用房，不表示展示权限');
  }
  for (const room of all.rooms.slice(0, 10)) {
    assert.equal(room.floorNumber, 1);
    assert.equal(room.listingVisible, false);
    assert.equal(room.visibility, 'internal');
    assert.equal(room.status, 'draft');
    assert.equal(room.layoutId, '');
    assert.equal(room.layoutStatus, 'pending');
    assert.equal(room.layoutName, '待配置');
    assert.equal(room.rooms, '');
    assert.equal(room.isPublic, false);
    assert.equal(presetApi.isPublicRoom(room), false);
  }
  assert.deepEqual(all.summary, {
    floorCount: 9, roomCount: 242, publicRoomCount: 232,
    internalRoomCount: 10, singleRoomCount: 232, unknownLayoutRoomCount: 10,
  });
});

test('公开列表筛选和逐条查询均不能泄露首层，102内部测试房保留', () => {
  const all = presetApi.getPreset();
  assert.deepEqual(presetApi.listPublicRooms({ floorNumber: 1, includeHidden: true }), []);
  assert.deepEqual(presetApi.listPublicRooms({ floorId: all.rooms[0].floorId }), []);
  for (const room of all.rooms.slice(0, 10)) {
    for (const key of [room.roomNo, room._id, room.id, room.houseId]) {
      assert.equal(presetApi.getPublicRoom(key), null);
      assert.deepEqual(presetApi.getInternalRoom(key), room);
    }
  }
  const internal102 = presetApi.getInternalRoom('102');
  assert.equal(internal102.roomNo, '102');
  assert.equal(internal102.listingVisible, false);
  internal102.listingVisible = true;
  internal102.floorNumber = 2;
  assert.equal(presetApi.isPublicRoom(internal102), false, '权限从只读源判定，修改返回副本不能升级首层');
  for (let floor = 2; floor <= 9; floor += 1) {
    assert.equal(presetApi.listPublicRooms({ floorNumber: floor }).length, 29);
  }
  const public201 = presetApi.getPublicRoom('201');
  assert.equal(public201.roomNo, '201');
  for (const key of [public201._id, public201.houseId]) assert.deepEqual(presetApi.getPublicRoom(key), public201);
  for (const bad of ['', '111', '200', '230', '1001', '../102', 102, null, {}]) {
    assert.equal(presetApi.getPublicRoom(bad), null);
  }
  assert.deepEqual(presetApi.listPublicRooms({ floorNumber: 10 }), []);
});

test('租金、面积及真实地址未知，全部显式null＋待配置，不制造0元或可签约事实', () => {
  const all = presetApi.getPreset();
  assert.equal(all.project.address, null);
  assert.equal(all.building.address, null);
  for (const room of all.rooms) {
    assert.equal(room.isTestData, true);
    assert.equal(room.price, null);
    assert.equal(room.area, null);
    assert.equal(room.address, null);
    assert.equal(room.priceStatus, 'pending');
    assert.equal(room.areaStatus, 'pending');
    assert.equal(room.addressStatus, 'pending');
    assert.equal(room.priceText, '待配置');
    assert.equal(room.areaText, '待配置');
    assert.equal(room.addressText, '地址待配置');
    assert.equal(room.canBook, false);
    assert.equal(Object.hasOwn(room, 'lease'), false);
  }
});

test('生成、过滤和查询均返回深副本，不修改调用参数或污染内置源', () => {
  const before = presetApi.getPreset();
  const filters = { floorNumber: 2, includeHidden: true };
  const filtersBefore = structuredClone(filters);
  const full = presetApi.getPreset();
  full.project.name = '被改项目';
  full.building.name = '被改楼栋';
  full.catalog.find((item) => item.kind === 'floor').slots.pop();
  full.rooms[0].roomNo = '9999';
  const listed = presetApi.listPublicRooms(filters);
  listed[0].price = 0;
  listed.pop();
  const detail = presetApi.getPublicRoom('201');
  detail.name = '被改房间';
  const internal = presetApi.getInternalRoom('102');
  internal.visibility = 'test-public';
  assert.deepEqual(filters, filtersBefore);
  assert.deepEqual(presetApi.getPreset(), before);
  assert.equal(presetApi.listPublicRooms().length, 232);
  assert.equal(presetApi.getPublicRoom('201').price, null);
  assert.equal(presetApi.getPublicRoom('102'), null);
  assert.equal(Object.isFrozen(presetApi), true);
});
