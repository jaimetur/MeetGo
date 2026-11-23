package app.meetgo.android

import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import org.json.JSONArray
import org.json.JSONObject

/** The Google Play subscription of MeetGo ("meetgo", base plans "monthly" and "yearly"; the 7-day free trial is an
 *  offer of the plans). The purchase token goes to the page (window.mgPurchase), which sends it to the API; the API
 *  checks it with Google and acknowledges it. */
class Billing(private val activity: MainActivity) : PurchasesUpdatedListener {
    @Volatile private var details: ProductDetails? = null
    private val client = BillingClient.newBuilder(activity)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()

    fun start() {
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(r: BillingResult) {
                if (r.responseCode == BillingClient.BillingResponseCode.OK) loadProducts()
            }
            override fun onBillingServiceDisconnected() { }
        })
    }

    private fun loadProducts() {
        val q = QueryProductDetailsParams.newBuilder().setProductList(listOf(
            QueryProductDetailsParams.Product.newBuilder().setProductId(PRODUCT).setProductType(BillingClient.ProductType.SUBS).build()
        )).build()
        // Billing 8: the products come in a QueryProductDetailsResult
        client.queryProductDetailsAsync(q) { r, res ->
            if (r.responseCode == BillingClient.BillingResponseCode.OK) details = res.productDetailsList.firstOrNull()
        }
    }

    /** For each base plan, the offer to buy: the free trial when the person can still have it, else the plain plan. */
    private fun offers(): List<Triple<String, ProductDetails.SubscriptionOfferDetails, Int>> {
        val d = details ?: return emptyList()
        return (d.subscriptionOfferDetails ?: emptyList()).groupBy { it.basePlanId }.mapNotNull { (plan, offers) ->
            val trial = offers.firstOrNull { o -> o.pricingPhases.pricingPhaseList.any { it.priceAmountMicros == 0L } }
            val o = trial ?: offers.firstOrNull { it.offerId == null } ?: offers.first()
            val days = if (trial == null) 0 else trial.pricingPhases.pricingPhaseList.firstOrNull { it.priceAmountMicros == 0L }
                ?.billingPeriod?.let { periodDays(it) } ?: 0
            Triple(plan, o, days)
        }
    }

    /** The plans with their price as Google Play shows it (JSON for the page); empty while not available. */
    fun productsJson(): String {
        val a = JSONArray()
        for ((plan, o, days) in offers()) {
            val paid = o.pricingPhases.pricingPhaseList.lastOrNull { it.priceAmountMicros > 0 } ?: continue
            a.put(JSONObject().put("plan", plan).put("price", paid.formattedPrice).put("trialDays", days))
        }
        return a.toString()
    }

    fun subscribe(plan: String) {
        val d = details
        val offer = offers().firstOrNull { it.first == plan }?.second
        if (d == null || offer == null) { result(JSONObject().put("error", "unavailable")); return }
        val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(
            BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d).setOfferToken(offer.offerToken).build()
        )).build()
        activity.runOnUiThread { client.launchBillingFlow(activity, params) }
    }

    /** A subscription already bought on this Google account (to link it again to the MeetGo account). */
    fun restore() {
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build()) { _, list ->
            val p = list.firstOrNull { it.purchaseState == Purchase.PurchaseState.PURCHASED }
            result(if (p != null) JSONObject().put("token", p.purchaseToken).put("product", PRODUCT)
                   else JSONObject().put("error", "none").put("message", activity.getString(R.string.no_purchase)))
        }
    }

    override fun onPurchasesUpdated(r: BillingResult, purchases: MutableList<Purchase>?) {
        when (r.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                val p = purchases?.firstOrNull { it.purchaseState == Purchase.PurchaseState.PURCHASED }
                if (p != null) result(JSONObject().put("token", p.purchaseToken).put("product", PRODUCT))
                else result(JSONObject().put("error", "pending").put("message", activity.getString(R.string.purchase_pending)))
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> result(JSONObject().put("error", "cancel"))
            else -> result(JSONObject().put("error", "failed").put("message", r.debugMessage.ifBlank { activity.getString(R.string.purchase_failed) }))
        }
    }

    private fun result(o: JSONObject) = activity.js("window.mgPurchase&&window.mgPurchase($o)")

    companion object {
        const val PRODUCT = "meetgo"

        /** "P7D", "P1W", "P1M" → days. */
        fun periodDays(p: String): Int {
            val m = Regex("""P(\d+)([DWMY])""").find(p) ?: return 0
            val n = m.groupValues[1].toInt()
            return when (m.groupValues[2]) { "D" -> n; "W" -> n * 7; "M" -> n * 30; else -> n * 365 }
        }
    }
}
