import axios from "axios";
import { Alchemy, Network } from "alchemy-sdk";
import { chunk, dedupeNormalized } from "../../shared/utils.js";

const ALCHEMY_DASHBOARD_API = "https://dashboard.alchemy.com/api";
const MAX_ADDRESS_BATCH = 500;

interface UpdateAddressArgs {
  webhookId: string;
  addressesToAdd: string[];
  addressesToRemove: string[];
}

interface CreateWebhookArgs {
  webhookUrl: string;
  webhookName: string;
  watchedAddresses: string[];
}

interface ManagerConfig {
  apiKey: string;
  authToken: string;
}

export class AlchemyWebhookManager {
  private readonly alchemy: Alchemy;
  private readonly authToken: string;

  constructor(managerConfig: ManagerConfig) {
    this.authToken = managerConfig.authToken;
    this.alchemy = new Alchemy({
      apiKey: managerConfig.apiKey,
      authToken: managerConfig.authToken,
      network: Network.BASE_SEPOLIA,
    });
  }

  async getWatchedAddresses(webhookId: string): Promise<string[]> {
    const notifyClient = (this.alchemy as { notify?: { getAddresses?: (id: string, opts?: { pageKey?: string }) => Promise<{ addresses?: string[]; pageKey?: string }> } }).notify;
    if (!notifyClient?.getAddresses) {
      throw new Error("Alchemy Notify client does not support fetching webhook addresses");
    }

    const addresses: string[] = [];
    let pageKey: string | undefined;

    do {
      const response = await notifyClient.getAddresses(webhookId, {
        ...(pageKey ? { pageKey } : {}),
      });
      addresses.push(...(response?.addresses ?? []).map(String));
      pageKey = response?.pageKey;
    } while (pageKey);

    return dedupeNormalized(addresses);
  }

  async createAddressActivityWebhook(args: CreateWebhookArgs): Promise<string> {
    const notifyClient = (this.alchemy as unknown as { notify?: { createWebhook?: (opts: { network: string; webhook_type: string; webhook_url: string; name: string; addresses: string[] }) => Promise<{ id?: string; webhookId?: string }> } }).notify;

    if (notifyClient?.createWebhook) {
      try {
        const maybe = await notifyClient.createWebhook({
          network: "BASE_SEPOLIA",
          webhook_type: "ADDRESS_ACTIVITY",
          webhook_url: args.webhookUrl,
          name: args.webhookName,
          addresses: args.watchedAddresses,
        });
        const id = maybe?.id ?? maybe?.webhookId;
        if (typeof id === "string" && id.length > 0) {
          return id;
        }
      } catch {
        // Fall back to Notify REST API.
      }
    }

    const response = await axios.post(
      `${ALCHEMY_DASHBOARD_API}/create-webhook`,
      {
        network: "BASE_SEPOLIA",
        webhook_type: "ADDRESS_ACTIVITY",
        webhook_url: args.webhookUrl,
        name: args.webhookName,
        addresses: args.watchedAddresses,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Alchemy-Token": this.authToken,
        },
        timeout: 30_000,
      }
    );

    const webhookId = response.data?.data?.id ?? response.data?.id;
    if (typeof webhookId !== "string" || !webhookId) {
      throw new Error("Could not parse webhook id from Alchemy create-webhook response");
    }
    return webhookId;
  }

  async updateWatchedAddresses(args: UpdateAddressArgs): Promise<void> {
    const addBatches = chunk(args.addressesToAdd, MAX_ADDRESS_BATCH);
    const removeBatches = chunk(args.addressesToRemove, MAX_ADDRESS_BATCH);
    const maxBatches = Math.max(addBatches.length, removeBatches.length, 1);

    for (let index = 0; index < maxBatches; index += 1) {
      const addressesToAdd = addBatches[index] ?? [];
      const addressesToRemove = removeBatches[index] ?? [];
      await this.updateWatchedAddressesSingleBatch({
        webhookId: args.webhookId,
        addressesToAdd,
        addressesToRemove,
      });
    }
  }

  private async updateWatchedAddressesSingleBatch(args: UpdateAddressArgs): Promise<void> {
    const notifyClient = (this.alchemy as { notify?: { updateWebhookAddresses?: (id: string, add: string[], remove: string[]) => Promise<void> } }).notify;

    if (notifyClient?.updateWebhookAddresses) {
      try {
        await notifyClient.updateWebhookAddresses(args.webhookId, args.addressesToAdd, args.addressesToRemove);
        return;
      } catch {
        // Fall back to Notify REST API.
      }
    }

    await axios.patch(
      `${ALCHEMY_DASHBOARD_API}/update-webhook-addresses`,
      {
        webhook_id: args.webhookId,
        addresses_to_add: args.addressesToAdd,
        addresses_to_remove: args.addressesToRemove,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Alchemy-Token": this.authToken,
        },
        timeout: 30_000,
      }
    );
  }
}
