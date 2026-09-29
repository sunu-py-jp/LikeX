import { CONNECTOR_PORTS, isConnectorPort, getConnectorPortPoint, getConnectorPortPoints, findNearestConnectorPort,
  getConnectorBounds, connectorLocalToWorld, connectorWorldToLocal } from "../src";
import type { ConnectorPoint, ConnectorPort, ConnectorEndpoint, ConnectorBinding, ConnectorBox, ConnectorOutline, ConnectorPortPoint,
  ConnectorTarget, ConnectorSnap } from "../src";
import { createOfficeConnectorGeometry, readOfficeConnectorShapeTag, getOfficePresetConnectorPort } from "../src/ooxml";

const box: ConnectorBox = { x: 1, y: 2, width: 30, height: 40, rotation: 90, flipY: true };
const binding: ConnectorBinding = { targetId: "shape-1", port: "topRight" };
const endpoint: ConnectorEndpoint = { x: 31, y: 2, binding };
const points: readonly ConnectorPortPoint[] = getConnectorPortPoints(box);
const point: ConnectorPoint = getConnectorPortPoint(box, binding.port);
const target: ConnectorTarget = { id: binding.targetId, box };
const outline: ConnectorOutline = { type: "polygon", points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
getConnectorPortPoints(box, outline);
createOfficeConnectorGeometry("triangle", outline);
readOfficeConnectorShapeTag(undefined);
getOfficePresetConnectorPort("rect", 1);
const snap: ConnectorSnap | undefined = findNearestConnectorPort(endpoint, [target], 12);
const port: ConnectorPort = CONNECTOR_PORTS[0];
const input: unknown = "bottom";
if (isConnectorPort(input)) getConnectorPortPoint(box, input);
connectorWorldToLocal(connectorLocalToWorld(point, box), box);
getConnectorBounds(endpoint, point);
// @ts-expect-error The ports form a closed set.
getConnectorPortPoint(box, "centre");
// @ts-expect-error Endpoint bindings require a target id.
const invalid: ConnectorEndpoint = { x: 1, y: 2, binding: { port: "top" } };
// @ts-expect-error Geometry and endpoint fields are immutable contracts.
endpoint.x = 4;
void [points, snap, port, invalid];
