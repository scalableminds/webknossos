import Toast from "libs/toast";
import messages from "messages";

const MAX_SERVER_ITEMS_PER_RESPONSE = 1000;

export function assertResponseLimit(collection: unknown[]) {
  if (collection.length === MAX_SERVER_ITEMS_PER_RESPONSE) {
    Toast.warning(messages["request.max_item_count_alert"], {
      sticky: true,
    });
  }
}
