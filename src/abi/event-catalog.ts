import { createHash } from "node:crypto";

import {
  toEventSelector,
  toEventSignature,
  type Abi,
  type AbiEvent,
  type Hex,
} from "viem";

import { AbiValidationError } from "../errors/evm-event-lake-errors.js";

export interface EventInputDefinition {
  readonly indexed: boolean;
  readonly name: string;
  readonly position: number;
  readonly solidityType: string;
}

export interface EventDefinition {
  readonly abiEvent: AbiEvent;
  readonly anonymous: boolean;
  readonly inputs: readonly EventInputDefinition[];
  readonly name: string;
  readonly signature: string;
  readonly topic0: Hex | null;
}

export class EventCatalog {
  public readonly abiFingerprint: string;
  public readonly canonicalAbiJson: string;
  public readonly events: readonly EventDefinition[];
  public readonly anonymousEvents: readonly EventDefinition[];

  readonly #eventsByTopic0: ReadonlyMap<Hex, readonly EventDefinition[]>;

  public constructor(abi: Abi) {
    this.canonicalAbiJson = canonicalizeAbi(abi);
    this.abiFingerprint = createAbiFingerprint(this.canonicalAbiJson);

    const events = abi
      .filter((item): item is AbiEvent => item.type === "event")
      .map((event) => createEventDefinition(event));
    if (events.length === 0) {
      throw new AbiValidationError("abi must contain at least one event");
    }

    this.events = Object.freeze(events);
    this.anonymousEvents = Object.freeze(
      events.filter((event) => event.anonymous),
    );

    const eventsByTopic0 = new Map<Hex, EventDefinition[]>();
    for (const event of events) {
      if (event.topic0 === null) continue;
      const matchingEvents = eventsByTopic0.get(event.topic0) ?? [];
      matchingEvents.push(event);
      eventsByTopic0.set(event.topic0, matchingEvents);
    }
    this.#eventsByTopic0 = new Map(
      [...eventsByTopic0].map(([topic, matchingEvents]) => [
        topic,
        Object.freeze(matchingEvents),
      ]),
    );
  }

  public findByTopic0(topic0: Hex | undefined): readonly EventDefinition[] {
    if (topic0 === undefined) return [];
    return this.#eventsByTopic0.get(topic0.toLowerCase() as Hex) ?? [];
  }

  public findBySignature(signature: string): EventDefinition | undefined {
    return this.events.find((event) => event.signature === signature);
  }

  public findByName(name: string): readonly EventDefinition[] {
    return Object.freeze(this.events.filter((event) => event.name === name));
  }
}

export function canonicalizeAbi(abi: Abi): string {
  const canonicalItems = (abi as readonly unknown[])
    .map((item) => canonicalizeJsonValue(item))
    .map((item) => JSON.stringify(item))
    .sort();
  return `[${canonicalItems.join(",")}]`;
}

export function createAbiFingerprint(canonicalAbiJson: string): string {
  return `sha256:${createHash("sha256").update(canonicalAbiJson).digest("hex")}`;
}

function createEventDefinition(event: AbiEvent): EventDefinition {
  try {
    const signature = toEventSignature(event);
    return Object.freeze({
      abiEvent: event,
      anonymous: event.anonymous ?? false,
      inputs: Object.freeze(
        event.inputs.map((input, position) =>
          createEventInputDefinition(input, position),
        ),
      ),
      name: event.name,
      signature,
      topic0: event.anonymous ? null : toEventSelector(event),
    });
  } catch (cause) {
    throw new AbiValidationError("Unable to create event catalog", { cause });
  }
}

function createEventInputDefinition(
  input: AbiEvent["inputs"][number],
  position: number,
): EventInputDefinition {
  return Object.freeze({
    indexed: input.indexed ?? false,
    name: input.name ?? "",
    position,
    solidityType: input.type,
  });
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nestedValue]) => nestedValue !== undefined)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, nestedValue]) => [key, canonicalizeJsonValue(nestedValue)]),
    );
  }
  return value;
}
