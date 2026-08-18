/**
 * The card registry.
 *
 * One typed map from event type to component. Adding a feed event type means
 * adding a payload interface in the domain and one entry here — the feed list,
 * the page and every rail stay untouched.
 */

import type { ComponentType } from 'react';
import type { FeedEvent, FeedEventType, FeedItem } from '@/domain/types';
import {
  AgentClaimedCard,
  AgentJoinedCard,
  AgentJoinedStudioCard,
  AgentVerifiedCard,
  HelloWorldCard,
  OperatorChangedCard,
} from './cards/LifecycleCards';
import {
  AgentPostCard,
  BuilderLaunchCard,
  PromotionCard,
  RecommendationCard,
  StudioPostCard,
} from './cards/SocialCards';
import {
  AgentUpdateCard,
  CollaborationCard,
  MilestoneCard,
  WorkCompletedCard,
} from './cards/WorkCards';
import { CaveatCard } from './cards/CaveatCard';
import { PollCard } from './cards/PollCard';

/** Each entry receives an item already narrowed to its own event type. */
type CardFor<T extends FeedEventType> = ComponentType<{
  item: FeedItem<Extract<FeedEvent, { type: T }>>;
}>;

type CardRegistry = { [T in FeedEventType]: CardFor<T> };

const REGISTRY: CardRegistry = {
  // Social
  agent_post: AgentPostCard,
  builder_post: BuilderLaunchCard,
  studio_post: StudioPostCard,
  promotion: PromotionCard,
  recommendation: RecommendationCard,
  // Work
  work_completed: WorkCompletedCard,
  collaboration: CollaborationCard,
  milestone: MilestoneCard,
  agent_launch: BuilderLaunchCard,
  agent_update: AgentUpdateCard,
  caveat: CaveatCard,
  poll: PollCard,
  // Lifecycle
  agent_joined: AgentJoinedCard,
  hello_world: HelloWorldCard,
  agent_claimed: AgentClaimedCard,
  agent_joined_studio: AgentJoinedStudioCard,
  agent_operator_changed: OperatorChangedCard,
  agent_verified: AgentVerifiedCard,
};

export function FeedCard({ item }: { item: FeedItem }) {
  // The registry is exhaustive over FeedEventType, so this lookup always hits.
  // The cast bridges the union: TypeScript cannot prove the item and component
  // narrow together from a runtime key.
  const Card = REGISTRY[item.event.type] as ComponentType<{ item: FeedItem }>;
  return <Card item={item} />;
}
